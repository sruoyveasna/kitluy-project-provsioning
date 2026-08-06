# WS-11-T008 — pairing-receipt ingestion authority re-review (Reviewer C)

| Field                | Value                                                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task                 | WS-11-T008 — adversarially verify the NEW-1 / NEW-2 / NEW-3 remediation and confirm nothing else was weakened                                                                            |
| Reviewer             | Reviewer C (did not author the correction; is neither Reviewer A nor Reviewer B)                                                                                                         |
| Subject commit       | `99af1b5` "fix(ws-11): bind pairing receipt identity in the door"                                                                                                                        |
| Principal artefact   | `supabase/migrations/20260806200000_0183_t008_receipt_ingestion_authority.sql`                                                                                                           |
| Secondary artefacts  | `services/kitluy-device-registry-service/src/pairing-receipt-ingestion.ts` (`mapSentinel`), `services/kitluy-device-registry-service/test/pairing-receipt-ingestion.integration.test.ts` |
| Worktree             | `C:/kl-rev-c` (detached at `99af1b5`)                                                                                                                                                    |
| Baseline compared to | `git show b276166:supabase/migrations/20260806060000_0176_terminal_pairing_receipt_ingestion.sql`                                                                                        |
| Probes executed      | 6 baseline (pre-fix door) + 8 fix-verification + 17 attack-the-fix (C-series) + 3 oracle + 3 redelivery = **37**                                                                         |
| New findings         | 3 — **NEW-4 (LOW)**, **NEW-5 (LOW)**, **NEW-6 (INFO)**; plus **NEW-7 (INFO, pre-existing in 0176)**                                                                                      |
| Probe residue        | **ZERO** — verified by census below                                                                                                                                                      |
| Overall verdict      | **APPROVED** (NEW-1, NEW-2 and NEW-3 are genuinely and completely closed; the new findings are fail-closed, LOW/INFO, and none is a security bypass)                                     |

---

## 1. Baseline reproduction — the original defects, reproduced not assumed

The pre-fix door body was extracted verbatim from history and re-created as a throwaway
function inside a rolled-back transaction:

```bash
git show b276166:supabase/migrations/20260806060000_0176_terminal_pairing_receipt_ingestion.sql \
  | awk '/^create or replace function kitluy_devices.ingest_terminal_pairing_receipt_v1\(/,/^\$ingest\$;/' \
  | sed 's/ingest_terminal_pairing_receipt_v1(/zz_probe_ingest_pre_fix_v1(/'
```

```sql
begin;
  do $b$ begin execute format('grant kitluy_pairing_receipt_governor to %I', current_user); end $b$;
  set local role kitluy_pairing_receipt_governor;
  <pre-fix body, renamed zz_probe_ingest_pre_fix_v1>   -- owned by the governor, as the real door is
  reset role;
  <probes B1-B10>
rollback;
```

Fixtures were **real** enrolled and assigned devices read out of the cloud database
(nothing was created):

| Alias    | Device id                              | Class       | Assignment                             |
| -------- | -------------------------------------- | ----------- | -------------------------------------- |
| `HUB_A`  | `00b6528b-01a2-434a-88d4-0d0d3c383faa` | `store_hub` | `active`, T…011 / S…015 / L…018, gen 1 |
| `TERM_A` | `093ccbd7-7ab8-44a3-bf98-a78b22718658` | `terminal`  | `pending_trust`, same scope, gen 1     |
| `HUB_B`  | `6097c676-84c4-423b-a466-997c8b616076` | `store_hub` | `pending_trust`, T…012 / S…017 / L…450 |
| `TERM_B` | `0b56d38e-c941-45a7-9cb8-8f5d90fb7ef6` | `terminal`  | `pending_trust`, T…012 / S…017 / L…450 |

### Baseline results (pre-fix door)

| Probe | Hostile delivery                                                | Pre-fix behaviour                                                                             | Matches Reviewer B |
| ----- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------ |
| B1    | `hub_device_id = terminal_device_id` (device pairs with itself) | `INGESTED`                                                                                    | ✅ yes             |
| B2    | `HUB_B` (another Tenant/Store) signs for `TERM_A`               | `INGESTED`                                                                                    | ✅ yes             |
| B3    | `HUB_A` + `TERM_A`, receipt claims Tenant/Store/Location B      | `INGESTED`                                                                                    | ✅ yes             |
| B4    | `terminal_assignment_generation = 6` against live generation 1  | `INGESTED`                                                                                    | ✅ yes             |
| B5    | valid baseline                                                  | `INGESTED`, `delivery_count 1`                                                                | ✅ yes             |
| B5b   | identical redelivery                                            | `DUPLICATE_IGNORED`, `delivery_count 2`                                                       | ✅ yes             |
| B6    | replayed `effect_key`, different receipt id, tampered body      | **raw SQLSTATE 23505** — `duplicate key value violates unique constraint "tpr_effect_key_uq"` | ✅ yes             |
| B10   | `hub_certificate_fingerprint = 'not-a-fingerprint'`             | **raw SQLSTATE 23514** — `violates check constraint "tpr_fingerprints_ck"`                    | ✅ yes             |

Receipt count moved `43 → 48` inside the transaction (B1–B5 each inserted a row), then
`rollback`. **All four hostile deliveries B1–B4 were accepted by the pre-fix door.
NEW-1, NEW-2 and NEW-3 are real, and were reproduced independently.**

Post-baseline residue check:

```
PROBE_FN_SURVIVED|0     ROLE_STILL_GRANTED|0     RECEIPTS|43
```

---

## 2. Fix verification — the same six probes against the LIVE door

Same fixtures, same call shapes, driven at
`kitluy_devices.ingest_terminal_pairing_receipt_v1` as it exists at `99af1b5`, entering
the governor identity and rolling back.

| Probe | Command (as `kitluy_pairing_receipt_governor`)             | Expected         | Actual                                                                                                                    | Verdict  |
| ----- | ---------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- | -------- |
| B1    | `…(ek, r, 'v1', s, TERM_A, TERM_A, 1, …)`                  | governed refusal | `P0001 KLUY-PAIRING-RECEIPT-WRONG-HUB: a device cannot pair with itself`                                                  | **PASS** |
| B2    | `…(ek, r, 'v1', s, HUB_B, TERM_A, 1, scope A …)`           | governed refusal | `P0001 KLUY-PAIRING-RECEIPT-WRONG-HUB: Hub 6097c676… is not the assigned Hub for terminal 093ccbd7…`                      | **PASS** |
| B3    | `…(ek, r, 'v1', s, HUB_A, TERM_A, 1, scope B …)`           | governed refusal | `P0001 KLUY-PAIRING-RECEIPT-WRONG-SCOPE: the receipt claims a Tenant, Store or Location the paired devices do not occupy` | **PASS** |
| B4    | `…(ek, r, 'v1', s, HUB_A, TERM_A, 6, …)`                   | governed refusal | `P0001 KLUY-PAIRING-RECEIPT-STALE-GENERATION: receipt generation 6 is not the live generation 1`                          | **PASS** |
| B5    | canonical valid call                                       | ingested         | `{"outcome":"INGESTED","delivery_count":1}`                                                                               | **PASS** |
| B5b   | identical redelivery                                       | one effect       | `{"outcome":"DUPLICATE_IGNORED","delivery_count":2}`, `paired_at` unchanged                                               | **PASS** |
| B6    | replay `effect_key` under a new receipt id + tampered body | governed refusal | `P0001 KLUY-PAIRING-RECEIPT-CONFLICT: effect key kh1.120c1c66….1 was already delivered by a different receipt`            | **PASS** |
| B10   | `hub_certificate_fingerprint = 'not-a-fingerprint'`        | governed refusal | `P0001 KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: a certificate fingerprint is not a 64-character hex digest`                  | **PASS** |

Receipt count moved `43 → 44` — **only the legitimate B5 receipt**. Every refusal left
no row. Then `rollback`.

Note also that the live door refused the **plain connecting role outright**: driving the
same eight probes as the unprivileged session user (`postgres`, `rolsuper = false` in this
deployment) produced `42501 permission denied for function ingest_terminal_pairing_receipt_v1`
for all eight. The capability must be entered.

---

## 3. Attacking the fix

17 further hostile / boundary deliveries (C-series), all against the live door inside a
rolled-back transaction. Receipt count returned to its starting value.

| #   | Attack                                                                     | Result                                                      | Assessment                                                                                                                                     |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Hub whose assignment is `pending_trust` (not `active`), same location      | **ACCEPTED**                                                | By design — `state in ('pending_trust','active')`, exact parity with `ingest_device_health_report_v1`. Not a defect.                           |
| C2  | Terminal whose assignment was revoked (no live assignment)                 | `KLUY-PAIRING-RECEIPT-DEVICE-UNASSIGNED`                    | Correct                                                                                                                                        |
| C3  | Hub whose `devices.lifecycle_state = 'suspended'` but assignment live      | **ACCEPTED**                                                | Parity observation — neither door checks `lifecycle_state`. See §3.3.                                                                          |
| C4  | The paired "terminal" is actually a `store_hub` device                     | **ACCEPTED**                                                | **NEW-5 (LOW)** — see below                                                                                                                    |
| C5  | `p_tenant_id = NULL`                                                       | **raw 23502** `null value in column "tenant_id" …`          | **NEW-4 (LOW)** — see below                                                                                                                    |
| C6  | `p_digital_store_id = NULL`                                                | **raw 23502**                                               | **NEW-4**                                                                                                                                      |
| C7  | `p_location_id = NULL`                                                     | **raw 23502**                                               | **NEW-4**                                                                                                                                      |
| C8  | `p_terminal_assignment_generation = NULL`                                  | **raw 23502**                                               | **NEW-4**                                                                                                                                      |
| C9  | `p_hub_device_id = NULL`                                                   | `KLUY-PAIRING-RECEIPT-WRONG-HUB: Hub <NULL> does not exist` | Governed — correct                                                                                                                             |
| C10 | `p_terminal_device_id = NULL`                                              | `KLUY-PAIRING-RECEIPT-DEVICE-UNASSIGNED`                    | Governed — correct                                                                                                                             |
| C11 | `p_effect_key = NULL`                                                      | **raw 23502**                                               | Pre-existing (0176) instance of NEW-4 class                                                                                                    |
| C12 | `p_paired_at = NULL`                                                       | **raw 23502**                                               | Pre-existing (0176)                                                                                                                            |
| C13 | `p_environment = NULL`                                                     | **raw 23502**                                               | Pre-existing (0176) — note the `coalesce(p_environment,'<null>')` guard formats the message but the `not in (…)` test is itself NULL-permeable |
| C14 | Fully legitimate receipt in the **other** scope (HUB_B + TERM_B + scope B) | `INGESTED`                                                  | Correct — the fix does not over-block                                                                                                          |
| C15 | Well-formed but **UPPERCASE** hex fingerprints and transcript hash         | `INGESTED`, stored lower-cased                              | Correct — `lower()` normalisation preserved                                                                                                    |
| C16 | HUB_B + TERM_B (co-located, real) but receipt claims scope A               | `KLUY-PAIRING-RECEIPT-WRONG-SCOPE`                          | Correct                                                                                                                                        |
| C17 | HUB_A + TERM_B (terminal in the other scope)                               | `KLUY-PAIRING-RECEIPT-WRONG-HUB`                            | Correct                                                                                                                                        |

### 3.1 NEW-4 (LOW) — the scope and generation checks 0183 added are NULL-permeable, and escape as raw SQLSTATE 23502

**Where:** `supabase/migrations/20260806200000_0183_t008_receipt_ingestion_authority.sql`,
the two checks the remediation itself introduced:

```sql
if p_tenant_id <> v_hub_assignment.tenant_id
   or p_digital_store_id <> v_hub_assignment.digital_store_id
   or p_location_id <> v_hub_assignment.store_location_id then
  raise exception 'KLUY-PAIRING-RECEIPT-WRONG-SCOPE: …';
end if;

if p_terminal_assignment_generation <> v_terminal_assignment.assignment_generation then
  raise exception 'KLUY-PAIRING-RECEIPT-STALE-GENERATION: …';
end if;
```

**What:** SQL three-valued logic. When any of those parameters is `NULL`, each comparison
evaluates to `NULL`, `NULL or NULL or NULL` is `NULL`, and `if NULL then` does **not**
fire. The delivery therefore walks straight **past the new scope authority and past the
new generation authority** and is stopped only by the projection table's `NOT NULL`
constraints — surfacing as a raw `23502`, with no `KLUY-` sentinel.

**Why it matters:** this is precisely the ungoverned-escape class that NEW-2 and NEW-3
were raised for and that group 0181 fixed for `assign_release_v1`. The consumer's
`mapSentinel` has no case for `23502`, so it returns `INTERNAL_ERROR` — the classification
that reads as _transient/retryable_ — for what is in truth a durable, permanent rejection.
That is the exact failure mode amendment `KLD-2026-07-28-001-A01 §2` names ("a durable
rejection is a cloud verdict, never a transport failure").

**Severity LOW, not MEDIUM, because:**

- it **fails closed** — no hostile delivery is accepted; nothing is stored;
- it is **unreachable through the consumer**: `validateReceiptEventShape` requires
  `UUID.test(...)` on all three scope fields and
  `Number.isInteger(gen) && gen >= 1`, so a NULL cannot be produced on the service path;
- it is a governance/defence-in-depth gap at the door, not a scope escape.

**Exact reproduction:**

```sql
begin;
do $b$ begin execute format('grant kitluy_pairing_receipt_governor to %I', current_user); end $b$;
set local role kitluy_pairing_receipt_governor;
select kitluy_devices.ingest_terminal_pairing_receipt_v1(
  'kh1.'||gen_random_uuid()||'.1', gen_random_uuid(), 'v1', gen_random_uuid(),
  '00b6528b-01a2-434a-88d4-0d0d3c383faa',            -- HUB_A
  '093ccbd7-7ab8-44a3-bf98-a78b22718658',            -- TERM_A
  1, 'laundry.t1.intake_cashier',
  null::uuid,                                        -- p_tenant_id  <-- NULL
  '00000000-0000-4000-8000-000000000015',
  '00000000-0000-4000-8000-000000000018',
  'development', repeat('ab',32), repeat('ab',32), 'serial-1', repeat('cd',32),
  'sig-1', '2026-08-05T10:00:00Z'::timestamptz, gen_random_uuid());
rollback;
-- ERROR 23502: null value in column "tenant_id" of relation "terminal_pairing_receipts"
--              violates not-null constraint      <-- no KLUY- sentinel
```

**Suggested (out-of-scope) correction:** an explicit `if p_tenant_id is null or … then raise
… KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA` ahead of the comparisons, matching the treatment
0183 already gave the fingerprints, or `is distinct from` in place of `<>`.

### 3.2 NEW-5 (LOW) — the paired terminal's device class is never checked

**What:** the door verifies that the **issuing Hub** exists and is a `store_hub`, but the
`p_terminal_device_id` side receives no class check at all — only an assignment lookup.
Probe C4 fed a second `store_hub` as the paired terminal and the receipt was `INGESTED`.
Fleet evidence can therefore record a Hub-to-Hub "pairing", and the projection
`read_terminal_pairing_state_v1` will report that Hub as a paired terminal with a
`terminal_profile_code`.

**Severity LOW:** no scope escape, no cross-Tenant reach (the co-location check still
applies), no authority is transferred — the record is simply not the kind of fact the
table exists to hold. The sibling `ingest_device_health_report_v1` also omits an
observed-device class check, so this is a **parity gap rather than a regression**; but the
0183 header claims parity on the Hub side specifically and leaves the terminal side
unmentioned.

**Exact reproduction:** C4 above — same call as B5 with
`p_terminal_device_id = '0015a412-5c46-4940-a11b-c4c20388b028'` (a `store_hub` assigned in
the same Tenant/Store/Location); result `{"outcome":"INGESTED","delivery_count":1}`.

### 3.3 NEW-6 (INFO) — the refusal family is a three-state device-existence/class oracle

The Hub-side refusals distinguish three states that the sibling door deliberately
collapses into one:

```
ORACLE|NONEXISTENT          |KLUY-PAIRING-RECEIPT-WRONG-HUB: Hub 11111111-… does not exist
ORACLE|REAL_TERMINAL_AS_HUB |KLUY-PAIRING-RECEIPT-WRONG-HUB: device … is a terminal, not a Store Hub
ORACLE|REAL_HUB_NO_ASSIGNMENT|KLUY-PAIRING-RECEIPT-HUB-UNASSIGNED: the issuing Hub has no live assignment
```

`ingest_device_health_report_v1` merges "not found" and "wrong class" into a single
`KLUY-FLEET-REPORT-NOT-HUB`. 0183 is therefore marginally more disclosive than the door it
cites as its parity reference. **INFO only**: the oracle is reachable only by a holder of
`EXECUTE` on the door (the authenticated Hub-sync identity), it discloses nothing about
Tenant or Store, and it never crosses the service boundary (see §5).

### 3.4 NEW-7 (INFO, pre-existing in 0176 — recorded, not attributed to this fix)

The redelivery-conflict comparison covers eleven columns but **not**
`terminal_assignment_generation`, `terminal_profile_code`, either certificate fingerprint,
`hub_certificate_serial` or `receipt_version`. A redelivery under the same `receipt_id`
mutating all of those returns `DUPLICATE_IGNORED`, not `CONFLICT`:

```
D1|first insert|INGESTED
D2|redelivery with mutated generation/profile/fingerprints/serial|{"outcome":"DUPLICATE_IGNORED","delivery_count":2}
D3|stored row unchanged: gen=1, serial=serial-1, profile=laundry.t1.intake_cashier
```

The stored row is **not corrupted** (the integrity trigger and the door's narrow `update`
both hold), so this is a reporting gap against the migration's own claim that "a redelivery
must assert the SAME facts", not a data-integrity defect. Pre-existing in group 0176,
untouched by 0183, recorded here for the register.

### 3.5 Observations that are NOT defects

- **The "WRONG-HUB" check is really a co-location check.** Any `store_hub` sharing the
  terminal's Tenant/Store/Location may sign for it (B2 and C17 are refused because the
  Hub is elsewhere, not because it is "not the terminal's Hub"). This is the strongest
  binding available in SQL — `device_assignments` carries no Hub reference — and is
  identical to the sibling door. The message wording overstates it slightly.
- **`pending_trust` Hubs may sign (C1)** and **`suspended`/`quarantined`/`retired`
  lifecycle states do not block (C3)** while the assignment remains live. Both match
  `ingest_device_health_report_v1` exactly. Recorded as parity facts.

---

## 4. Legitimate path and idempotency — not traded away

| Check                                                                                                            | Result                                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Fully valid receipt (real Hub + real terminal, same Tenant/Store/Location, live generation, well-formed digests) | `{"outcome":"INGESTED","paired_at":"2026-08-05T10:00:00+00:00","delivery_count":1}` (B5) |
| Identical redelivery                                                                                             | `{"outcome":"DUPLICATE_IGNORED","delivery_count":2}` — `paired_at` unmoved (B5b)         |
| Third delivery (suite test)                                                                                      | `DUPLICATE_IGNORED`, `deliveryCount 3`, exactly one projection row                       |
| Legitimate ingestion in a **second real scope**                                                                  | `INGESTED` (C14) — the fix does not over-block foreign-but-valid scopes                  |
| Uppercase-hex digests                                                                                            | `INGESTED` and stored lower-cased (C15) — normalisation preserved                        |
| `paired_at` never moved, freshness-only update                                                                   | Confirmed by suite tests 1–3 and by D3                                                   |

**Idempotency is intact.**

---

## 5. Privilege and information-leakage verification (independent of the migration's own guard)

### 5.1 The governor's new reach is READ-ONLY

```
PRIV|kitluy_pairing_receipt_governor|kitluy_devices.devices           |sel=true|ins=false|upd=false|del=false|trunc=false|ref=false
PRIV|kitluy_pairing_receipt_governor|kitluy_devices.device_assignments|sel=true|ins=false|upd=false|del=false|trunc=false|ref=false
```

### 5.2 Both new policies are SELECT-only

```
POLICY|kitluy_devices.devices           |devices_pairing_receipt_governor|cmd=r|roles=kitluy_pairing_receipt_governor|qual=true|check=-
POLICY|kitluy_devices.device_assignments|da_pairing_receipt_governor    |cmd=r|roles=kitluy_pairing_receipt_governor|qual=true|check=-
```

`cmd=r` is `SELECT`; `check=-` means no `WITH CHECK` clause exists, so neither policy can
admit a write. RLS on both tables remains `enabled=true, forced=true`.

### 5.3 No other role gained anything

```
EXEC|public       |false     EXEC|anon           |false     EXEC|authenticated|false
EXEC|service_role |false     EXEC|postgres       |false     EXEC|kitluy_worker_service|false
EXEC|kitluy_provisioning_service|false
EXEC|kitluy_edge_sync_service|true   EXEC|kitluy_test_harness|true   EXEC|kitluy_pairing_receipt_governor|true
GOVROLE|kitluy_pairing_receipt_governor|login=false|super=false|bypassrls=false
MEMBEROF: (no rows) — no role holds membership of the governor
DEFINER|ingest_terminal_pairing_receipt_v1|owner=kitluy_pairing_receipt_governor|secdef=true|cfg=search_path=pg_catalog, kitluy_devices, kitluy_ops, extensions
```

`anon`, `authenticated`, `service_role` and the plain connecting role **cannot execute the
door** — confirmed both by catalogue and empirically (§2, `42501` for all eight probes
before entering the identity).

`service_role` does hold `select/insert/update` on `kitluy_devices.devices` and
`device_assignments`, but that is **pre-existing** and not from 0183 — it comes from
`supabase/migrations/20260728120120_0120_device_enrollment_and_identity.sql:1953`
(`grant select, insert, update on all tables in schema kitluy_devices to service_role`),
and is neutralised at runtime by `FORCE` RLS with no `service_role` policy. 0183 grants
to nothing except `kitluy_pairing_receipt_governor`.

### 5.4 Information leakage on a cross-scope refusal

- `KLUY-PAIRING-RECEIPT-WRONG-SCOPE` names **no** Tenant, Store or Location — the actual
  owning scope is never disclosed. Verified against B3 and C16.
- `KLUY-PAIRING-RECEIPT-WRONG-HUB` echoes only the two device ids the **caller supplied**.
- `KLUY-PAIRING-RECEIPT-STALE-GENERATION` discloses the **live generation integer**
  (`… is not the live generation 1`). Identical to the sibling door's
  `KLUY-FLEET-REPORT-STALE-GENERATION`; parity, low value to an attacker.
- The three-state Hub oracle of §3.3 is the only other disclosure.

**At the consumer boundary nothing leaks.** `mapSentinel` collapses all five new sentinels
to a single `REJECTED_SCOPE`, which is the _same_ result the envelope check already
returns — so a caller cannot even distinguish a database refusal from a consumer refusal.
The logger is called with `{ operation, correlationId, result }` only; the raw message is
never logged, and the suite's own log-hygiene test asserts the key set is exactly
`["correlationId","operation","result"]` and that no 64-hex material appears.

---

## 6. Regression totals (exact, as executed in `C:/kl-rev-c`)

| Command                                                                                                           | Result                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                  | done (695 packages)                                                                                                                                                                   |
| `pnpm build`                                                                                                      | 72 successful, 72 total                                                                                                                                                               |
| `pnpm --filter kitluy-device-registry-service exec vitest run test/pairing-receipt-ingestion.integration.test.ts` | **Test Files 1 passed (1) · Tests 11 passed (11)** — matches the expected 11                                                                                                          |
| `pnpm --filter kitluy-device-registry-service test`                                                               | **Test Files 35 passed (35) · Tests 374 passed (374)**                                                                                                                                |
| `pnpm --filter kitluy-hub-agent test`                                                                             | run 1: 1 failed / 367 passed / 2 skipped; **run 2 (clean): Test Files 33 passed, 1 skipped (34) · Tests 368 passed, 2 skipped (370)** — see note below                                |
| `pnpm --filter @kitluy/device-identity test`                                                                      | **Test Files 38 passed (38) · Tests 872 passed (872)**                                                                                                                                |
| `pnpm --filter @kitluy/terminal-local-store test`                                                                 | **Test Files 1 passed (1) · Tests 14 passed (14)**                                                                                                                                    |
| `pnpm db:test`                                                                                                    | **exit 3 — 39 PASS lines, 1 ASSERT FAIL** (`ws11-fleet-honest`): `69 device(s) report ACTIVE while no PKI configuration is approved` → **RESIDUE, not a regression** (evidence below) |
| `pnpm hub:db:test`                                                                                                | **exit 3 — 23 PASS lines, 1 ASSERT FAIL**: `a non-canonical logical profile code is assigned` → **RESIDUE, not a regression**                                                         |
| `pnpm migrations:validate`                                                                                        | **passed (82 migration files)**                                                                                                                                                       |
| `pnpm hub:db:validate`                                                                                            | **all static checks passed (40 Hub migration files)**                                                                                                                                 |
| `pnpm secret:scan`                                                                                                | **passed (1405 tracked files)**                                                                                                                                                       |

### 6.1 The hub-agent flake

`test/edge-lan.integration.test.ts > E: mutual-proof pairing over the LAN` failed once in
the first full run. Re-run **in isolation**: passed (`Tests 1 passed | 7 skipped`). Re-run
of the **entire suite**: 368 passed, zero failures. It is a shared-Hub-database
concurrency artefact between parallel test files, and it is structurally unrelated to
`99af1b5` — 0183 is a **cloud** migration that touches only
`kitluy_devices.terminal_pairing_receipts`, while this test exercises the Hub-side LAN
pairing route against `kitluy_hub_local`.

### 6.2 The `db:test` ASSERT FAIL is residue — evidence, not assertion

Four independent lines of evidence:

1. **Reviewer A recorded the identical failure before 0183 existed.**
   `00_AI_HANDOFF/shared/2026-08-06__SHARED__WS-11-T008__INITIAL-INDEPENDENT-REVIEW__AI-REVIEW.md:424`
   records `pnpm db:test` → **"exit 3 — 39 PASS lines, 1 ASSERT FAIL"** and line 543 quotes
   the same assertion text (`21 device(s) report ACTIVE while no PKI configuration is
approved`) against the shared database at a commit _before_ `99af1b5`. My run stops at
   the **same 39th PASS, on the same assertion**; only the count has grown, because more
   suites have run since.
2. **Every ACTIVE device predates my session.** All 22 fixture families
   (`WS11-S5x-HUB-*`, `WS11-*RACE-HUB-*`, `WS11-REC/RTE/POP/ACT/CMP/AMB/TSC-HUB-*`) have a
   `min(created_at)` of `06:15:27Z`–`06:18:12Z`; my first command ran at ~`07:45Z`. These
   are device-registry-service replacement/race/recovery fixtures that legitimately
   activate Hubs in `development`.
3. **The assertion is written for a virgin database.** `supabase/tests/assertions.sql:2407`
   requires `count(*) = 0` for `device_fleet_status.fleet_status = 'ACTIVE'`; any prior run
   of the registry suite falsifies it. The from-zero closeout figure of record is
   `db:test` **242 PASS, exit 0**
   (`…WS-11-T007__DEVICE-SECURITY-OFFLINE-RECOVERY-AND-CONCURRENCY-VERIFICATION__AI-HANDOFF.md:134`).
4. **There is no causal path from 0183.** The governor has `ins=false/upd=false/del=false`
   on `kitluy_devices.devices` (§5.1), the door's only write is an `insert` into
   `terminal_pairing_receipts`, and the assertion reads `device_fleet_status`. Further,
   `grep -n "pairing_receipt\|0176\|0183" supabase/tests/assertions.sql` returns **nothing** —
   `db:test` carries no assertion covering this door at all.

`hub:db:test` fails on the same shared-database basis and against a **different database
entirely** (`kitluy_hub_local`), which group 0183 does not touch; Reviewer A recorded the
identical "23 PASS lines, 1 ASSERT FAIL" at line 425.

**Neither ASSERT FAIL is attributable to `99af1b5`.** Re-proving the 242 / 43 from-zero
figures requires a reset, which is explicitly out of bounds for this review.

---

## 7. Test-quality judgement

### 7.1 The fixture is genuinely fixed

The T004 fixture invented `randomUUID()` for **both** devices, which is exactly why a door
with no identity checks passed its suite. The new fixture enrols and assigns **real**
devices through the governed doors:

- `enrolAndAssign` / `enrolAndAssignAt` drive `enroll_device_v1` → `create_device_claim_v1`
  → `redeem_device_claim_v1`, producing a real device with a real live assignment;
- `hubDeviceId` is enrolled once in `beforeAll` against the `WS11-T001-HUB-PROBE` hardware
  profile (a `store_hub` profile — so the door's class check is genuinely satisfied rather
  than bypassed);
- **each event provisions its own terminal** via `WS11-T005-TERM-PROBE`, and the generation
  is read live with `liveGeneration(terminal)` rather than hard-coded;
- the cross-scope probes use `OTHER_SCOPE` — a **real** second Tenant/Store/Location
  (`…012 / …017 / …450`) with a really-assigned foreign Hub, so B2/B3 exercise a genuine
  cross-tenancy condition rather than an unresolvable UUID.

This is the right correction: the fixture now satisfies every precondition the door checks,
so a passing test means the door refused for the _hostile_ reason and not because the
fixture was unresolvable.

### 7.2 The new tests are non-vacuous — proven, not asserted

The NEW-1 test is well constructed for the specific reason the defect hid: it makes the
**envelope agree** with each hostile receipt
(`ingestion.ingest(wrongHub, { hubDeviceId: foreignHub, tenantId: TENANT, … })`), so the
consumer's own scope check cannot fire and the refusal can only come from the door. It
then asserts `count(*) = 0` for all four hostile receipt ids.

**Proof of non-vacuity — end-to-end, against a genuinely reverted door.** I captured the
live door definition (`md5 = dcd3e248954cbbb30d26739888834c0c`), verified the restore
script round-trips to the identical md5, then replaced the door body with the pre-fix 0176
body (`md5 = f660a065d45ddca6c03f9b149b7ff905`) and ran the real test binary:

```
$ pnpm --filter kitluy-device-registry-service exec vitest run \
    test/pairing-receipt-ingestion.integration.test.ts -t "NEW-2"

 × T008 NEW-2/NEW-3: a replayed effect key and a malformed digest are GOVERNED refusals, never raw SQLSTATEs
   → expected 'duplicate key value violates unique c…' to contain 'KLUY-PAIRING-RECEIPT-CONFLICT'
 Test Files  1 failed (1)
      Tests  1 failed | 10 skipped (11)
```

The door was then restored and re-verified byte-for-byte
(`RESTORED_MD5|dcd3e248954cbbb30d26739888834c0c|owner=kitluy_pairing_receipt_governor|secdef=true`),
and the full suite re-run: **11 passed (11)**.

This test was chosen for the live revert precisely because its two hostile probes run
inside client transactions it rolls back itself, so the reverted-door run created **no
hostile receipt rows** — only the one legitimate receipt the suite inserts on every normal
run. Reverting the door for the NEW-1 test would have committed four permanently
undeletable hostile receipts (the `tpr_integrity` trigger refuses `DELETE` from every
identity), so that test's non-vacuity is established instead by the §1 baseline: the same
four deliveries returned `INGESTED` against the pre-fix body, and `INGESTED` fails both
`toBe("REJECTED_SCOPE")` and the trailing `count(*) = 0` assertion.

### 7.3 Coverage gap worth recording

`supabase/tests/assertions.sql` contains **no** assertion for group 0176 or 0183 — the
door's authority is proven only by the vitest integration suite. Not a defect in this
change, but it means the SQL-level regression net does not cover this door.

---

## 8. Residue census

### 8.1 My probes — ZERO residue

| Item                                                           | Found                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `zz_probe*` functions surviving in any schema                  | **0**                                                                                                                                                  |
| `kitluy_pairing_receipt_governor` still granted to any role    | **0**                                                                                                                                                  |
| Receipts carrying my probe serials (`serial-1`, `serial-EVIL`) | **0**                                                                                                                                                  |
| Receipts touching any of my probe fixture terminals            | **0**                                                                                                                                                  |
| Temporary objects named `zz*` in `kitluy_devices`              | **0**                                                                                                                                                  |
| Devices enrolled by me directly                                | **0** (I created no devices; all fixtures were pre-existing rows read read-only)                                                                       |
| Live door definition                                           | `md5 dcd3e248954cbbb30d26739888834c0c`, owner `kitluy_pairing_receipt_governor`, `secdef=true` — **byte-for-byte identical to the pre-review capture** |

Every write probe ran inside `begin; … rollback;`. The only two committed statements in
this review were the temporary door swap and its restore, both md5-verified.

### 8.2 Test-suite residue — attributed honestly

Running the published suites (as this review was required to do) leaves fixtures behind by
their own design, on a shared database that already carried such residue:

| Object                                          | Before my session (`< 07:45Z`) | Added by my suite runs |
| ----------------------------------------------- | -----------------------------: | ---------------------: |
| `kitluy_devices.terminal_pairing_receipts`      |                             43 |                 **19** |
| `kitluy_devices.devices` with `T008-RCPT-%` tag |                             56 |                 **46** |

All of it is legitimate fixture data produced by `enrolAndAssign` and by valid `INGESTED`
receipts; none of it is hostile, and none of it came from a probe. Pairing-receipt rows
cannot be deleted by design (`tpr_integrity` refuses `DELETE` from every identity,
including the governor), so this residue is inherent to running the suite against a
non-reset database.

### 8.3 Worktree

```
$ cd /c/kl-rev-c && git status --porcelain
(empty before writing this file; only this review document afterwards)
$ git log --oneline -1
99af1b5 fix(ws-11): bind pairing receipt identity in the door
```

No product file under `supabase/`, `hub/`, `services/`, `packages/`, `apps/`, `verticals/`
or `scripts/` was modified. All probe scripts were written to the session scratchpad
outside the repository.

---

## 9. Verdict

### **APPROVED**

- **NEW-1 (MEDIUM) — CLOSED.** All four previously-accepted deliveries (B1–B4) are now
  refused in SQL with governed `KLUY-` sentinels, verified against the live door with real
  enrolled and assigned devices, and each leaves no row. The binding is in the door, not
  only in the consumer, satisfying repository rule 7.
- **NEW-2 (MEDIUM) — CLOSED.** A replayed `effect_key` under a different receipt id is now
  `KLUY-PAIRING-RECEIPT-CONFLICT`; the raw `23505` from `tpr_effect_key_uq` is gone.
- **NEW-3 (LOW) — CLOSED.** A malformed digest is now
  `KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA`; the raw `23514` is gone.
- **Nothing was traded away.** Legitimate ingestion, `DUPLICATE_IGNORED` with an
  incrementing `delivery_count`, the immovability of `paired_at`, the separation of Hub
  time from cloud time, and the "the cloud never authors pairing" posture all hold.
- **The privilege addition is genuinely read-only** and reached no other role; `anon`,
  `authenticated`, `service_role` and the plain connecting role still cannot execute the
  door.
- **No scope leakage** past the door, and none at all past the consumer.
- **No regression** in any suite; both `ASSERT FAIL`s are pre-existing shared-database
  residue, corroborated by Reviewer A's record of the identical failure points before this
  change existed.

Recorded for the register, none of them blocking:

| Finding   | Severity | Summary                                                                                                                                                                                                                                                                  |
| --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **NEW-4** | LOW      | The scope and generation checks 0183 added are NULL-permeable; a NULL scope field or generation walks past them and escapes as raw `23502`, which the consumer maps to `INTERNAL_ERROR` rather than a durable rejection. Fails closed; unreachable through the consumer. |
| **NEW-5** | LOW      | The paired terminal's `device_class` is never checked — a `store_hub` can be recorded as a paired terminal. Parity gap with the sibling door, not a regression.                                                                                                          |
| **NEW-6** | INFO     | The Hub refusal family is a three-state existence/class oracle where the sibling door collapses to one sentinel. Reachable only by a door holder; discloses no Tenant or Store.                                                                                          |
| **NEW-7** | INFO     | Pre-existing in 0176: the redelivery-conflict comparison omits generation, profile, fingerprints, serial and version, so such a redelivery returns `DUPLICATE_IGNORED` rather than `CONFLICT`. The stored row is not corrupted.                                          |
