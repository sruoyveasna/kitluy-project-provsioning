# KitLuy Independent Review Record

## 0. Review identity

| Field            | Value                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task ID          | WS-10-T000..T009 (Cycle 9 — synchronization and configuration publication)                                                                                                                                                                                                                                                                                         |
| Task title       | Delivery-state alignment, outbox leasing, signed Hub→cloud transmission, idempotent cloud ingestion, acknowledgement/rejection/retry/dead-letter, governed conflict clearance, cloud→Hub delivery and provider dedupe, signed grant + snapshot publication, cursor recovery and operator repair                                                                    |
| Reviewer         | Independent review subagent — authored none of the reviewed commits                                                                                                                                                                                                                                                                                                |
| Reviewed commits | `6cf713c`, `c78ddc1`, `42a2ce9`, `f63dbd6`, `3321dc5`, `170f1a1`, `e2390b2`, `8a64492`, `b52e569`, **and `5caede7`** (the evidence/register/handoff commit, which contains the document under audit)                                                                                                                                                               |
| Base commit      | `ea2f7ce` (`docs(decision): record KLD-2026-07-28-001-A01 and resolve C26`)                                                                                                                                                                                                                                                                                        |
| HEAD at review   | `5caede731da8a55e5c27b3581e9a7ae304a71079` — clean tree before and after. The task brief named the range `6cf713c..b52e569`; `b52e569` is an ancestor of HEAD and `5caede7` sits on top of it, so the audited range is `6cf713c..5caede7`.                                                                                                                         |
| Branch/worktree  | `main`, `C:\dev\HET-KITLUY-PROJECT`; Hub DB `kitluy_hub_local` and cloud DB `postgres` both on container `supabase_db_kitluy-local`                                                                                                                                                                                                                                |
| Review date      | 2026-07-28                                                                                                                                                                                                                                                                                                                                                         |
| Decision         | **APPROVED-WITH-CONDITIONS** — every mandated gate re-executed by the reviewer PASSED, and 8 of the 10 attack classes I was asked to break held under adversarial SQL. **TWO findings BLOCK the IMPLEMENTED-IN-DEV promotion: RV-001 and RV-002.** Both are demonstrated, reproducible defeats of a safety property the evidence affirmatively claims is enforced. |

Content binding (re-review required if any of these change):

| File                                                         | sha256                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `hub/migrations/0015_sync_delivery_state_alignment.sql`      | `471d59f9acabaec2d47ec4a0e1b7a36fecfc0ed716158ab4b2698022049f5913` |
| `hub/migrations/0016_sync_outbox_leasing.sql`                | `10155852ad08082e1a9ed14a0820ae1e8fdc33f7c00273d140de86c1ab56f989` |
| `hub/migrations/0019_sync_delivery_outcomes.sql`             | `241797b4c0577b728756e49262cbd2d57dc62e4592d6dfa0acea50157089c80c` |
| `hub/migrations/0020_revoke_public_execute.sql`              | `18ffc32bd6962354603281a6cd912ffded43ea18f0a3d56d7ad99ab274d5650b` |
| `hub/migrations/0022_signed_grants_and_activation.sql`       | `0e1a22e2e0b248052879e52057f510a5a064f6d13b6a8542a12cec2173e2cbad` |
| `services/kitluy-hub-agent/src/hub/effect-contract.ts`       | `224f504bb08886134fcf778b021ce24017d75b0abc2609060adf5aa6bad02ceb` |
| `services/kitluy-hub-agent/src/hub/sync/reconciliation.ts`   | `dba3b68fedd1074b4782d94ed57d9c46260a7bbd703e0ab697740201cbda49ce` |
| `services/kitluy-hub-agent/src/hub/sync/grants.ts`           | `51d6ee0786e09d5335019106b3e95dc3ad173c0322f4699e1cd72de68fa25922` |
| `services/kitluy-hub-agent/src/hub/sync/delivery-outcome.ts` | `27d594845100bc6c1661f7ec62565eba44d8a3b31ec50ae57a5bd4821c38e392` |
| `services/kitluy-sync-service/src/ingestion.ts`              | `7300d61a39bf0fcdc3f1ee104a7074e8097bf98a76f17cd91995d8b769190c6f` |
| `supabase/migrations/20260728100110_0110_sync_ingestion.sql` | `fd0119911b8096ea505e1994528c63b6f51c4ed798573b8f2a79550f488ecc82` |

## 1. Independence check

| Question                                          | Answer                                                                                                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Did the reviewer author any reviewed commit?      | No. Session began at `5caede7` with a clean tree.                                                                                                                                                                                                 |
| Re-executed the gates, or read reported results?  | Re-executed. Every number in §4 was observed in my own terminal.                                                                                                                                                                                  |
| Did the verdict rest on the authors' test suites? | No. Their suites were one input. The two blocking findings come from SQL probes I wrote, which their suites do not perform.                                                                                                                       |
| Files written by the reviewer                     | Exactly one: this record. `git status --short` was empty before and after.                                                                                                                                                                        |
| Probe data disposition                            | Every mutating probe ran inside `BEGIN … ROLLBACK`. No probe committed. Hub assertion count re-verified at 32 after probing.                                                                                                                      |
| Gate-order hazard (KLRISK-HUB-006)                | Respected. I did **not** run `pnpm db:reset`. `pnpm db:test` and `pnpm test:rls` are separate cases from `reset` in `scripts/database/db-exec.mjs` and do not recreate the cluster; the Hub DB survived (24/24 applied, 0 drift, verified after). |

## 2. Materials reviewed

- `docs/evidence/phase1/ws-10/WS-10-EXECUTION-EVIDENCE.md` (the claims under audit).
- `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md` — KLD-2026-07-28-001-A01 (lines 255–302), C26 (line 308), Cycle-9 findings C27–C29 (lines 310–319), G9–G11, KLRISK-HUB-001..006.
- `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md:209` (the WS-10 row).
- `hub/migrations/0015`–`0023`; `hub/tests/assertions.sql` §29a/29b/29c.
- `services/kitluy-hub-agent/src/hub/sync/*.ts`, `effect-contract.ts`, `outbox.ts`, `idempotency.ts`, `sync-engine.ts`.
- `packages/sync-protocol/src/index.ts`; `services/kitluy-sync-service/src/{ingestion,http,main,index}.ts`.
- `supabase/migrations/20260728100110_0110_sync_ingestion.sql`.

## 3. Scope and boundary check

| Check                                   | Result                                                                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Applied migration edited?               | **No.** `pnpm hub:db:status`: 24 files, 24 applied, **0 pending, 0 checksum drift, 0 missing**. The A01 enum alignment is an additive `ALTER TYPE … RENAME VALUE` in `0015`; `0001` retains its journalled sha256 `35a942da…`. |
| Secrets in source?                      | **No.** `pnpm secret:scan` passed over **1062 tracked files**. `signing.ts:116` reads the dev key from the environment and refuses when absent; no default key exists.                                                         |
| Floating-point money in WS-10 code?     | **None found.** No `parseFloat`, `toFixed`, `Number(...minor)`, `* 100` or `/ 100` anywhere in `src/hub/sync/`, `kitluy-sync-service/src/` or `packages/sync-protocol/src/`.                                                   |
| `[REQUIRED: …]` filled in with a guess? | **No.** All five are genuine and unfilled: `grants.ts:23`, `operations.ts:34`, `reconciliation.ts:44`, `signing.ts:31`, `0022_…sql:84`. Each names the open item (C29 / KLREQ-029 / KLREQ-030 / BLK-005).                      |
| Complete T1→T4 lifecycle claimed?       | **No — correctly.** The status row at `…evidence-register…:209` states "KLREQ-024 and KLREQ-028 remain open so **no complete T1->T4 lifecycle is claimed**". Evidence §7 repeats it. Confirmed accurate.                       |
| `edge_finance` ledger added?            | **No.** WS-10 added none; the Hub assertion still refuses the schema.                                                                                                                                                          |

## 4. Re-executed gates — ACTUAL results

| Gate                                           | Evidence claims        | Reviewer observed                                                                                                   | Verdict                         |
| ---------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `pnpm hub:db:status`                           | 24 applied / 0 drift   | 24 applied, 0 pending, 0 drift, 0 missing                                                                           | **reproduces**                  |
| `pnpm hub:db:test` (`grep -c "NOTICE:  PASS"`) | **32**                 | **32**, zero FAIL/ERROR lines                                                                                       | **reproduces**                  |
| `pnpm db:test`                                 | **124**                | **124**                                                                                                             | **reproduces**                  |
| `pnpm test:rls`                                | **95** cases           | **94** — runner's own itemization: `14+9 baseline; WS5 7+7; WS6 10+9; WS7 13+6; WS8 13+6` = 23+14+19+19+19 = **94** | **does NOT reproduce — RV-005** |
| `pnpm verify`                                  | **PASS 11/11**         | **PASS 11/11**, exit 0                                                                                              | **reproduces**                  |
| `@kitluy-services/kitluy-hub-agent`            | 261 passed / 2 skipped | **261 passed / 2 skipped**, files 21 passed / 1 skipped                                                             | **reproduces**                  |
| `@kitluy/sync-protocol`                        | 21 passed              | **21 passed**                                                                                                       | **reproduces**                  |
| `@kitluy-services/kitluy-sync-service`         | 18 passed              | **18 passed** (13 ingestion + 5 http)                                                                               | **reproduces**                  |

The evidence document's §1 caveat about an earlier `109 passed / 154 skipped` run is honest and is not cited as evidence anywhere. I found no failure hidden inside a green summary.

## 5. Reviewer probes — every probe, including those that found nothing

Environment facts established first, because they bound every conclusion below:

- `kitluy_sync_worker` is **NOT** a member of `kitluy_hub_runtime`. Only `postgres` is a member of both.
- All `kitluy_*` roles are **NOLOGIN** (`rolcanlogin = f`), and `hub-database.ts:28` connects as **`postgres`**, the table/function **owner**. The role separation WS-10 relies on is therefore defined but **not exercised** by any running component today.
- Function ACLs: `clear_reconciliation` = `postgres`, `kitluy_hub_runtime` only. `raise_reconciliation`, `acknowledge/reject/defer/dead_letter_outbox_event`, `advance_sync_cursor` additionally granted to `kitluy_sync_worker`. Matches the claimed asymmetry.
- Table ACLs: `kitluy_sync_worker` holds **SELECT, INSERT, UPDATE** on `edge_sync.outbox`.

| #   | Probe                                                                                           | Result                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Worker EXECUTEs `edge_sync.clear_reconciliation()` directly                                     | **BLOCKED** — `ERROR: permission denied for function clear_reconciliation`                                                                                                                                                                                                                                                                                        |
| 2   | Worker bare `UPDATE … SET reconciliation_state='cleared'`, no marker                            | **BLOCKED** — `KLUY-EDGE-RECONCILIATION-GOVERNED`                                                                                                                                                                                                                                                                                                                 |
| 3   | Worker calls `set_config('kitluy.reconciliation_governed','on',true)` itself, then UPDATEs      | **SUCCEEDED — `UPDATE 1`.** See RV-001.                                                                                                                                                                                                                                                                                                                           |
| 4   | Broad `deny` at `digital_store` scope + narrow `allow` at `location` scope, resolve at location | **`allow` RETURNED.** See RV-002.                                                                                                                                                                                                                                                                                                                                 |
| 5   | Same actor/key resolved at the `digital_store` scope                                            | `deny` — confirms both rows are live, unexpired and visible; only the scope filter hides the deny                                                                                                                                                                                                                                                                 |
| 6   | `mark_snapshot_verified(id, <the row's own manifest_sha256>)`                                   | **SUCCEEDED** — snapshot flipped `downloaded → verified` with no independent content hash and no signature check in SQL. See RV-009.                                                                                                                                                                                                                              |
| 7   | `activate_snapshot()` on the snapshot from probe 6                                              | **SUCCEEDED** — became `active`, previous stood down to `staged`. Activation's "verified only" gate is only as strong as whoever called probe 6.                                                                                                                                                                                                                  |
| 8   | End-to-end impact of probe 3: does the divergence disappear?                                    | **YES.** `reconciliation_required → cloud_acknowledged` in `edge_sync.external_sync_status`, authority `automation:not-a-real-policy:delivery:none`, `reconciliation_clearing_event_id` = an arbitrary unrelated event, **`audit_rows = 0`**.                                                                                                                     |
| 9   | Fabricate a cloud acknowledgement (no ack id)                                                   | **HELD.** `classifyOutcome` (`delivery-outcome.ts:73`) defers with `EDGE_ACK_IDENTITY_MISSING`; `acknowledge_outbox_event` (`0019:64`) raises on an empty ack id; `outbox_ack_ck` unchanged.                                                                                                                                                                      |
| 10  | Turn a transport failure into a durable rejection                                               | **HELD.** `is_durable_rejection_code` (`0019:30`) is a closed 6-value set in the DB; `reject_outbox_event` refuses anything else; `defer_outbox_event` refuses a durable code; `releaseOutboxLease` (`outbox-lease.ts:194`) refuses one too. `isDurableCloudRejection` fails **closed toward retry** for unknown codes.                                           |
| 11  | Advance the acked cursor past an item the DB refused to acknowledge                             | **HELD.** `acknowledge_outbox_event` **raises** on a lease mismatch and returns `false` only when the row is _already_ acknowledged, so the `changed:false` path at `delivery-outcome.ts:137` is safe. Contiguity breaks at the first unacknowledged item (`:345`); `advance_sync_cursor` is monotonic and `sync_cursor_push_order_ck` still caps acked ≤ pushed. |
| 12  | Skip ahead of an unacknowledged outbox item                                                     | **HELD.** `lease_outbox_batch` (`0016`) `exit`s on `reconciliation_state='required'`, on a live lease, and on un-elapsed backoff; it `continue`s only past `rejected` / `dead_letter`. See RV-007 for the `rejected` case.                                                                                                                                        |
| 13  | Same `kh1.*` key for two different business effects                                             | **NOT FOUND.** Ordinal is `slot * 1000 + occurrenceIndex` (`effect-contract.ts:138`); slots are deduped per name (`:82`); occurrence ≥ 1000 **refuses** rather than wrapping (`:129`). Namespace is a per-command UUID.                                                                                                                                           |
| 14  | Different `kh1.*` keys for the same effect on replay                                            | **NOT FOUND.** Occurrence order is insertion order (`outbox.ts:134`), and every repeating emitter iterates a deterministically ordered source: `listGarments` uses `order by created_at, id` (`repositories/laundry.ts:328`).                                                                                                                                     |
| 15  | Cloud ingests the same business effect twice                                                    | **HELD.** `sync_inbox_effect_key unique (store_location_id, effect_key)`; `findIngested` re-reports the **original** `cloud_ack_id` (`ingestion.ts:231`); `enforce_inbox_single_completion` allows exactly one `RECEIVED → APPLIED                                                                                                                                | REJECTED`. |
| 16  | Unverified batch applies something                                                              | **HELD.** `ingestBatch` verifies the signature first and returns before any `apply` (`ingestion.ts:175`); `sync_batches_verified_check` refuses `APPLIED` without `signature_verified`.                                                                                                                                                                           |
| 17  | Cloud response answering an event the batch never sent                                          | **HELD** where used — `assertResponseCoversBatch` (`transmission.ts:377`) rejects unmatched, partial and unknown-event responses. See RV-010 for the caller-dependency.                                                                                                                                                                                           |
| 18  | Offline `allow` with no approved signed policy                                                  | **HELD.** Resolver `continue`s when `offline_validity_seconds is null` and when the window elapsed (`0022:168`); `permission_grant_projection_offline_ck` makes duration and policy reference inseparable; `projectGrant` refuses the mismatched pair.                                                                                                            |
| 19  | Roll back to a guessed snapshot                                                                 | **HELD.** `rollback_snapshot` reads the recorded `previous_snapshot_id` and **refuses** when it is null (`0022:324`) rather than choosing one.                                                                                                                                                                                                                    |
| 20  | Locally author or widen a projected grant                                                       | **HELD.** `permission_grant_projection_immutability` refuses **all** UPDATE and DELETE (`0022:97`).                                                                                                                                                                                                                                                               |
| 21  | Provider outcome overwritten by a contradictory redelivery                                      | **HELD.** Unique on the ruled triple (`0021:83`); `outcome_sha256` separates duplicate from contradiction; `provider_outcome_delivery_conflict_ck` forces a conflict record; `EDGE_PROVIDER_OUTCOME_CONFLICT` raised at `inbox.ts:281`.                                                                                                                           |
| 22  | Cloud-side RLS weakened                                                                         | **HELD.** All four `kitluy_sync` relations are `ENABLE` **+ FORCE**; SELECT-only `authenticated` policies scoped by `current_location_ids()`; zero anon policies; no client write policy; no DELETE grant.                                                                                                                                                        |
| 23  | PUBLIC EXECUTE on Hub procedures                                                                | **HELD.** Assertion 29c reports **30** `edge_*` procedures, none PUBLIC-executable, and asserts the grant asymmetry directly.                                                                                                                                                                                                                                     |

## 6. Findings

### RV-001 — A delivery worker CAN clear `reconciliation_required` — **BLOCKS PROMOTION**

**Severity: HIGH.** Direct, demonstrated violation of KLD-2026-07-28-001-A01 §5.

The conflict-dimension guard `edge_sync.enforce_state_dimension_independence` gates on
`current_setting('kitluy.reconciliation_governed', true) <> 'on'`
(`hub/migrations/0015_sync_delivery_state_alignment.sql:192`, re-created forward at `0016:97`).
`kitluy.reconciliation_governed` is an **unregistered custom GUC**, and PostgreSQL lets **any**
role set one via `set_config()`. `kitluy_sync_worker` holds **UPDATE** on `edge_sync.outbox`.

`0015:144–146` states the intent explicitly and incorrectly:

> "`kitluy_sync_worker` holds UPDATE on every edge_sync relation (0012), so the rule … cannot rest on grants. **This trigger makes it structural**."

It does not. Probe 3, as `kitluy_sync_worker`:

```sql
SELECT set_config('kitluy.reconciliation_governed','on',true);  -- returns 'on'
UPDATE edge_sync.outbox SET reconciliation_state='cleared', … ;  -- UPDATE 1
```

Probe 8 shows the full consequence: the item moved from `reconciliation_required` to
`cloud_acknowledged` in the shared external projection, carrying a forged authority string
(`automation:not-a-real-policy:delivery:none`), a `reconciliation_clearing_event_id` pointing at an
arbitrary unrelated event, and **zero `edge_audit.audit_event` rows** — because the audit row is
written by the TypeScript caller (`reconciliation.ts:216`), never by the procedure. Because
`lease_outbox_batch` stops on a `required` head, this is also how a worker unblocks its own stream
past a known divergence.

The §5 requirements defeated: _not independently_, _authorized actor or governed automated
reconciliation_, _immutable audit_, and _correlation to the repair_. The CHECK constraints at
`0015:121` are satisfied by arbitrary non-null strings and any FK-valid event id, so they do not
compensate.

**Register impact.** C27's disposition ("**CLOSED 2026-07-28**") and the evidence §3 row
("§5 worker may not clear … governed-marker trigger + `0020`") are both **overstated**. `0020` did
close the PUBLIC EXECUTE hole — assertion 29c proves the grant asymmetry — but the trigger that
grant asymmetry depends on is bypassable by the very role it names.

**Mitigating context, stated plainly:** all `kitluy_*` roles are NOLOGIN and the Hub agent connects
as the owner `postgres`, so nothing currently connects as `kitluy_sync_worker` and there is no live
exploit path in the dev environment. That is genuine mitigation and equally genuine evidence that
the §5 separation is **not exercised at all** today.

**Fix direction:** make `raise_reconciliation` / `clear_reconciliation` `SECURITY DEFINER` and
revoke the worker's ability to write those columns — PostgreSQL supports column-level UPDATE grants,
so `GRANT UPDATE (delivery_state, attempt_count, …) ON edge_sync.outbox TO kitluy_sync_worker` with
the nine `reconciliation_*` columns withheld would make the rule structural for real. An assertion
should then attempt the bypass and require it to fail.

### RV-002 — A narrow `allow` defeats a broad `deny` — **BLOCKS PROMOTION**

**Severity: HIGH.** Contradicts KLD-2026-07-28-001 Group 5 / KLREQ-025 ("deny overrides allow") and
hard rule 7 ("never weaken RLS or permission checks").

`edge_config.resolve_permission_grant` filters candidate grants on an **exact** scope tuple —
`g.scope_type = p_scope_type and (g.scope_id is not distinct from p_scope_id)`
(`hub/migrations/0022_signed_grants_and_activation.sql:149-150`). There is no scope-hierarchy walk,
so a deny recorded at an enclosing scope is **never loaded** and cannot override anything.

Probe 4: with an active, unexpired `deny` for `laundry.booking.void` at `scope_type='digital_store'`
and an `allow` for the same actor and key at `scope_type='location'`, resolving at the location scope
returned **`allow`**. Probe 5 confirmed the deny is live by resolving at its own scope (`deny`).

The column comment at `0022:88` claims the opposite:

> "allow | deny. DENY OVERRIDES ALLOW **at every scope**, so a narrow allow can never defeat a broad deny."

The in-function comment at `:158` ("Checked before any allow can be accumulated, so no ordering of
rows can let an allow win") is true but describes only intra-scope ordering, which is not the risk.

**Mitigating context:** `resolveGrant` / `resolve_permission_grant` have **no production caller** —
only `grants.ts` and tests reference them — so no authorization decision currently flows through
this resolver. The defect is latent. But the gap is **not recorded anywhere**: evidence §4 marks
Group 5 "PARTIAL, recorded — see §5", and §5 discusses only the 21-field enumeration (C29). The
deny-scope limitation is undisclosed.

**Fix direction:** either implement the scope hierarchy so an enclosing deny is evaluated, or —
if single-scope resolution is the intended contract — correct `0022:88` in a forward migration
comment and record the limitation as an open item, because the sentence as written is a false
authorization guarantee.

### RV-003 — Cloud migration header claims RPCs that do not exist

**Severity: MEDIUM.** Does not block; must be corrected.

`supabase/migrations/20260728100110_0110_sync_ingestion.sql:4` declares the group contains:

> `+ ingest_hub_batch_v1 / record_hub_event_v1 RPCs (idempotent ingestion).`

Neither function exists. A repo-wide grep finds the identifiers **only on that comment line**, and
`pg_proc` for schema `kitluy_sync` in the live cloud DB contains exactly one function,
`enforce_inbox_single_completion`. The migration creates four tables, one trigger function, triggers,
RLS and grants — no RPCs. Since applied migrations are never edited, the correction belongs in a
forward migration comment plus the evidence document.

### RV-004 — WS-10 delivers no wired execution path, and the evidence under-discloses this

**Severity: MEDIUM.** Does not block IMPLEMENTED-IN-DEV, but the status wording should say it.

Every WS-10 entry point has **zero production callers** — tests only:

- `ingestBatch` (`kitluy-sync-service/src/ingestion.ts:170`) — no HTTP route, no DB adapter.
  `IngestionPorts` has **no implementation** anywhere outside `test/ingestion.test.ts`.
- `prepareSignedBatch`, `assertResponseCoversBatch`, `manifestDeclarationProblems`,
  `applyBatchResponse` — referenced only from `test/sync-transmission.test.ts` and
  `test/sync-delivery-outcome.test.ts`. `SignedBatchTransport` has no implementation.
- `resolveGrant` / `projectGrant` — no caller.
- `services/kitluy-hub-agent/src/sync-engine.ts` is still the **separate in-memory simulation**
  against `LocalDatabaseAdapter`; it does not use leasing, signing or the WS-10 outcome path.

Evidence §7 discloses "no cloud↔Hub integration run exists … with the transport injected", which is
true but softer than reality: there is no delivery worker and no ingestion adapter to integrate.
The building blocks are individually well-tested; nothing assembles them. The status row's phrase
"outbox delivery, signed transmission, idempotent cloud ingestion" reads as capability rather than
as components.

### RV-005 — `test:rls` is 94, not 95

**Severity: LOW.** Does not block.

Evidence §1 gate 4 and the status register row (`…evidence-register…:209`, "test:rls 95 unchanged")
both state 95. The runner's own summary itemizes `14+9` baseline, WS5 `7+7`, WS6 `10+9`, WS7 `13+6`,
WS8 `13+6` = **94**. The itemization in the evidence document (`14+9 baseline, WS5 14, WS6 19,
WS7 19, WS8 19`) also sums to 94, so the document contradicts itself. The figure appears to be
carried forward unchanged from the WS-09 review, which recorded the same 95.

### RV-006 — Assertion 29c covers 30 procedures, not 22

**Severity: LOW (cosmetic).** Evidence §6 says 29c "locks it shut for all 22 `edge_*` procedures".
The assertion's own notice reports **30**: "none of the 30 edge_* procedures is EXECUTE-able by
PUBLIC". The assertion is correct; the prose is stale.

### RV-007 — A durable `rejected` raises no conflict and is stepped over

**Severity: MEDIUM.** Needs an owner ruling rather than a silent fix.

`reject_outbox_event` (`0019:109`) records a durable cloud refusal and does **not** call
`raise_reconciliation`, and `lease_outbox_batch` (`0016`) `continue`s past `rejected` rows. So a
business effect the cloud **definitively refused** is dropped from the stream, the Hub keeps sending
subsequent effects, and no operator obligation is created — the external projection reports
`cloud_rejected`, not `reconciliation_required`.

The asymmetry is striking: `dead_letter`, which by construction means _no cloud verdict was ever
observed_, **does** raise the conflict dimension (`0019:298`) on the reasoning that "a dead letter
nobody has to act on is a silent discard". A durable rejection of a payment or custody effect is a
stronger divergence signal and gets less handling. For the append-only financial/custody classes this
looks like a genuine gap in "no silent conflict resolution", but whether a rejection should raise
reconciliation is a design decision above a reviewer, so I record it rather than assert a defect.

### RV-008 — Outcome procedures skip the lease check entirely when `p_lease_id IS NULL`

**Severity: LOW.** Defence-in-depth only.

`acknowledge_outbox_event`, `reject_outbox_event`, `defer_outbox_event` and
`dead_letter_outbox_event` all guard with `and (p_lease_id is null or lease_id = p_lease_id)`
(`0019:92`, `:150`, `:215`, `:277`). Passing `NULL` bypasses lease matching on **any** outbox row.
All four are granted to `kitluy_sync_worker`. The substantive protections still hold — an
acknowledgement still requires the cloud's own ack id, and a rejection still requires a durable code
— so this weakens attribution ("which attempt earned this answer"), not truthfulness. The comment at
`0019:104` ("requires … the lease of the attempt that earned it") is stronger than the code.

### RV-009 — `mark_snapshot_verified` verifies nothing on its own

**Severity: LOW.** Honest in the TypeScript, overstated in the SQL comment.

The function compares the caller-supplied hash against the row's **own** declared `manifest_sha256`
(`0022:208`). Probe 6 passed the stored value straight back and the snapshot flipped to `verified`;
probe 7 then activated it. No signature is checked anywhere in SQL. The real verification —
signature over the manifest, then the independently recomputed `snapshotManifestSha256` — lives only
in `configuration.ts:153-188`, and that code is correct and well-reasoned. But the migration comment
at `0022:236` ("An UNVERIFIED snapshot is refused. `state` starts at `downloaded`, so the only route
to `active` runs through `mark_snapshot_verified`") reads as a database guarantee that the database
does not provide. Given KLRISK-HUB-003 already establishes direct DB access as a trust boundary, this
is consistent with the accepted posture — but the wording should match.

### RV-010 — `applyBatchResponse` does not itself enforce `assertResponseCoversBatch`

**Severity: LOW.** `assertResponseCoversBatch` (`transmission.ts:377`) is the guard that stops a
cloud response from answering for events the batch never sent, but `applyBatchResponse`
(`delivery-outcome.ts:303`) never calls it — the two are separate functions a caller must remember to
pair. Mitigated because `acknowledge_outbox_event` raises `KLUY-EDGE-OUTBOX-UNKNOWN` on an unknown
event id, so the failure is loud rather than silent. Worth folding the assertion into
`applyBatchResponse` once an orchestrator exists (RV-004).

## 7. What WS-10 does NOT establish

The evidence document's own §7 is accurate as far as it goes. Adding what my review establishes:

- **No delivery worker and no ingestion adapter exist** (RV-004). WS-10 delivers well-tested
  components, not a running synchronization path. Nothing in this cycle has ever moved a batch.
- **No production signer** — `createProductionBatchSigner` refuses; custody `[REQUIRED: …]` on
  BLK-005. Verified correct.
- **The §5 worker/clearer separation is not enforced** (RV-001) and is **not exercised** — no
  component connects as `kitluy_sync_worker`; the Hub agent connects as the owner.
- **The grant resolver is not an authorization path** (RV-002, RV-004) — nothing consults it, and
  deny-over-allow holds only within one exact scope.
- **No complete T1→T4 lifecycle**, correctly and repeatedly disclaimed. KLREQ-024 and KLREQ-028
  remain open. Confirmed: WS-10 changes nothing here.
- **Not INTEGRATION-VERIFIED**, not pilot-ready, not production-ready. Correctly stated.

## 8. Decision rationale

The engineering quality of this cycle is high, and I want to say so before the conditions. The
separation of transient from durable failure codes is enforced in **both** TypeScript and the
database, and fails closed toward retry in both. The `kh1.*` strided-ordinal design genuinely
survives the collision and replay-determinism attacks I aimed at it, including the loop cases. The
refusal to invent an offline grace period, to guess the 21-field grant enumeration, or to reuse
`fleet.sync.trigger` for KLREQ-029/030 is exactly the discipline the repository rules ask for, and
each refusal fails closed rather than being quietly relaxed. The C27 PUBLIC-EXECUTE discovery was a
real find, self-reported, and the fix is asserted. Eight of the ten attack classes I was asked to
break held under adversarial SQL run as the privileged role.

Against that: two claims in the shipped evidence are demonstrably false, and both concern
authorization.

RV-001 is the serious one. Amendment §5 is the clause WS-10-T005 exists to enforce; the evidence
§3 table asserts it clause by clause, the register records C27 as CLOSED, and the migration text says
the trigger "makes it structural". A three-statement probe as the named role defeats it, with a
forged authority and no audit trail. That the roles are currently NOLOGIN makes it unexploitable
today; it does not make the claim true, and "enforced" is precisely what rule 5 forbids calling
something that is not.

RV-002 is a false guarantee written into a migration comment about deny-over-allow, latent only
because nothing calls the resolver yet.

Neither finding is a reason to revert the cycle — the code is sound to keep on `main`, and most of it
is better than it needed to be. Both are reasons the **status row may not advance** while it asserts
properties that do not hold. Hence conditions rather than rejection.

## 9. Conditions on the IMPLEMENTED-IN-DEV promotion

| #   | Condition                                                                                                                                                                                                                                                                                                                                            | Satisfies   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| C1  | Make the §5 separation structural (SECURITY DEFINER + column-scoped UPDATE grants, or equivalent), **or** correct evidence §3, register C27 and the status row to state that §5 rests on grants plus caller discipline and is not enforced against a role holding UPDATE. Add an assertion that attempts the probe-3 bypass and requires it to fail. | RV-001      |
| C2  | Implement cross-scope deny, **or** correct the `0022:88` claim in a forward migration comment and record the single-scope limitation as an open required value alongside C29.                                                                                                                                                                        | RV-002      |
| C3  | Correct the `0110` header's RPC claim in a forward migration comment and in the evidence document.                                                                                                                                                                                                                                                   | RV-003      |
| C4  | State in the status row that WS-10 ships components with no wired delivery worker or ingestion adapter.                                                                                                                                                                                                                                              | RV-004      |
| C5  | Correct `test:rls` to **94** in the evidence document and the status register row, and correct "22 `edge_*` procedures" to **30**.                                                                                                                                                                                                                   | RV-005/6    |
| C6  | Record RV-007 (durable rejection raises no conflict) in the decision register for an owner ruling.                                                                                                                                                                                                                                                   | RV-007      |
| C7  | Advisory, not blocking: tighten RV-008 (null-lease bypass), RV-009 and RV-010 wording or behaviour under a governed task.                                                                                                                                                                                                                            | RV-008/9/10 |

## 10. Reviewer truth statement

Every command result quoted here was produced in my own terminal during this review. Every SQL probe
ran inside a transaction I rolled back; no probe committed, and `pnpm hub:db:test` still reports 32
assertions after probing. I did not run `pnpm db:reset`, so KLRISK-HUB-006 was not triggered and no
Hub-backed suite silently skipped — the 261/2 split was observed directly. I wrote exactly one file,
this record; `git status --short` is empty. Where a claim reproduced, I said so; where it did not
(RV-005), I said so; and where I attacked something and failed to break it (probes 9–23), I recorded
the failure as evidence rather than omitting it.
