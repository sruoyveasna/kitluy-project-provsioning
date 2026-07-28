# WS-10 — Synchronization and Configuration Publication: execution evidence

**Cycle:** 9 (2026-07-28)
**Authority:** owner decision `KLD-2026-07-28-001` (Groups 1–7) and amendment
`KLD-2026-07-28-001-A01` (delivery/conflict state model, resolving conflict C26)
**Scope fence:** `00_AI_HANDOFF/000_ACTIVE_PHASE.md` §8 — WS-10 only
**Status claimed:** `IMPLEMENTED-IN-DEV` — **not** INTEGRATION-VERIFIED, and not
pilot- or production-ready (KLD-EVIDENCE-001)

> Every number below was produced by a command that was actually executed. Where
> a gate was skipped, blocked or run under a caveat, that is stated in the same
> line rather than in a footnote.

---

## 1. Gate results

**GATE ORDER MATTERS** — see KLRISK-HUB-006 in §6. The cloud reset recreates the
whole local PostgreSQL cluster and destroys `kitluy_hub_local`, so the cloud gate
runs FIRST and the Hub is rebuilt afterwards. A run in the wrong order still
prints PASS while silently skipping 154 Hub-backed tests.

| #   | Gate             | Command                                  | Result                                                                |
| --- | ---------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| 1   | Cloud static     | `pnpm db:validate`                       | **PASS** — 18 migration files                                         |
| 2   | Cloud from zero  | `pnpm db:reset` → `pnpm db:seed`         | **PASS** — group 0110 applied                                         |
| 3   | Cloud assertions | `pnpm db:test`                           | **PASS** — **124** `NOTICE: PASS` (121 before + 3 new in section 27)  |
| 4   | Cloud RLS        | `pnpm test:rls`                          | **PASS** — **94** cases (23 baseline, WS5 14, WS6 19, WS7 19, WS8 19) |
| 5   | Hub static       | `pnpm hub:db:validate`                   | **PASS** — 27 Hub migration files                                     |
| 6   | Hub from zero    | `pnpm hub:db:reset` → `pnpm hub:db:seed` | **PASS** — 27 migrations applied, fixtures seeded                     |
| 7   | Hub assertions   | `pnpm hub:db:test`                       | **PASS** — **35** `NOTICE: PASS` (29 at WS-09 close + 6 new)          |
| 8   | Hub journal      | `pnpm hub:db:status`                     | **PASS** — 27 applied, 0 pending, 0 checksum drift, 0 missing         |
| 9   | Repository       | `pnpm verify`                            | **PASS — 11/11**                                                      |

Counting command for gate 7, pinned in code as `HUB_DB_ASSERTION_CONTRACT`:

```bash
pnpm hub:db:test | grep -c "NOTICE:  PASS"
```

`grep -c PASS` also matches the runner's own summary line and reports one too
many. A count derived from the summary line is never reported.

### Suite counts

| Suite                                  | Result                                                     |
| -------------------------------------- | ---------------------------------------------------------- |
| `@kitluy-services/kitluy-hub-agent`    | **274 passed, 2 skipped** (22 files: 21 passed, 1 skipped) |
| `@kitluy/sync-protocol`                | **21 passed**                                              |
| `@kitluy-services/kitluy-sync-service` | **18 passed**                                              |
| `pnpm verify` unit gate                | **PASS** across 60 workspace tasks                         |

The 2 skipped hub-agent tests are the opt-in destructive backup/restore suite
(`KITLUY_HUB_DESTRUCTIVE_TESTS=1`, run alone) — unchanged from WS-09.

**Caveat recorded rather than buried:** an earlier evidence run reported
`109 passed / 154 skipped` for the hub-agent suite. That run followed the cloud
reset without rebuilding the Hub database, so every DB-backed suite skipped. It
is NOT cited as evidence anywhere; the 274/2 figures above come from a run with
a live Hub database.

---

## 2. What was built, per task

| Task | Deliverable                                | Evidence                                                                                                                                                                                     |
| ---- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T000 | Additive state alignment (A01)             | `hub/migrations/0015_sync_delivery_state_alignment.sql`; assertions 29a/29b                                                                                                                  |
| T001 | Outbox leasing, `pending → in_flight`      | `0016_sync_outbox_leasing.sql`; `src/hub/sync/outbox-lease.ts`; `test/sync-outbox-lease.test.ts` 17/17                                                                                       |
| T002 | Signed Hub→cloud transmission              | `0017_sync_transmission_batches.sql`; `src/hub/sync/{signing,transmission}.ts`; `test/sync-transmission.test.ts` 19/19; `@kitluy/sync-protocol` corrected                                    |
| T003 | Idempotent cloud ingestion, `kh1.*`        | `0018_hub_effect_keys.sql`; `supabase/migrations/…0110_sync_ingestion.sql`; `src/hub/effect-contract.ts`; `kitluy-sync-service/src/ingestion.ts`; 18 + 10 tests                              |
| T004 | Ack, rejection, retry/backoff, dead-letter | `0019_sync_delivery_outcomes.sql`; `src/hub/sync/delivery-outcome.ts`; `test/sync-delivery-outcome.test.ts` 17/17                                                                            |
| T005 | Independent dimensions, governed clearance | `0020_revoke_public_execute.sql` + `0024_governed_marker_and_scope_hierarchy.sql` (review RV-001); `src/hub/sync/reconciliation.ts`; `test/sync-reconciliation.test.ts` 11/11; assertion 29c |
| T006 | Cloud→Hub delivery, provider outcomes      | `0021_cloud_inbox_and_provider_outcomes.sql`; `src/hub/sync/inbox.ts`; `test/sync-inbox.test.ts` 15/15                                                                                       |
| T007 | Signed grant + snapshot publication        | `0022_signed_grants_and_activation.sql`; `src/hub/sync/{grants,configuration}.ts`                                                                                                            |
| T008 | Verification, atomic activation, rollback  | `0022` + `0024` scope-chain resolver (review RV-002); `test/sync-configuration.test.ts` 22/22; assertion 29d                                                                                 |
| T009 | Cursor recovery, health, operator repair   | `0023_operator_repair_and_recovery.sql`; `src/hub/sync/operations.ts`; `test/sync-operations.test.ts` 8/8                                                                                    |

---

## 3. Amendment KLD-2026-07-28-001-A01 — clause by clause

| Clause                                   | Where it is enforced                                                                                                                                                                                                                                                                                                | Test                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| §2 canonical delivery states             | `0015` `ALTER TYPE … RENAME VALUE` (member OIDs preserved, so 0009/0012/0013 constraints, indexes and views keep working)                                                                                                                                                                                           | assertion 29a; `sync-protocol.test.ts`       |
| §2 `rejected` is DURABLE                 | `edge_sync.is_durable_rejection_code` in the DB; `reject_outbox_event` refuses anything else; `defer_outbox_event` refuses a durable code                                                                                                                                                                           | `sync-delivery-outcome.test.ts`              |
| §2 no fabricated acknowledgement         | 0009 `outbox_ack_ck` (unchanged) + `acknowledge_outbox_event` requires the cloud ack id and a matching lease                                                                                                                                                                                                        | `sync-delivery-outcome.test.ts`              |
| §3 orthogonal conflict dimension         | `edge_sync.reconciliation_state` is a SEPARATE type; `reconciliation_required` is absent from `delivery_state`                                                                                                                                                                                                      | assertion 29b                                |
| §3 independent transitions               | `enforce_state_dimension_independence` refuses one statement moving both                                                                                                                                                                                                                                            | assertion 29a; `sync-reconciliation.test.ts` |
| §4 ONE shared projection, conflict first | `@kitluy/sync-protocol.projectExternalSyncStatus` + `edge_sync.external_sync_status`, held equal over the whole cross product                                                                                                                                                                                       | `sync-transmission.test.ts` conformance test |
| §5 worker may not clear                  | **`0024`** — the gate is the EXECUTING IDENTITY of a NOLOGIN, memberless owner role, checked by the trigger; plus `0020` revoking PUBLIC EXECUTE and `clear_reconciliation` granted to `kitluy_hub_runtime` only. The 0015 GUC gate this row originally credited was FORGEABLE (review RV-001) and enforced nothing | assertion 29c; `sync-reconciliation.test.ts` |
| §5 authority, reason, correlation, audit | 0015 CHECK constraints enforce authority, reason and correlation AT THE DATABASE. The immutable audit row is written by `src/hub/sync/reconciliation.ts` — a CALLER CONVENTION, not a database guarantee (review RV-011): a future caller with EXECUTE could clear without writing one. Recorded as KLRISK-HUB-007  | `sync-reconciliation.test.ts`                |

---

## 4. Decisions implemented from KLD-2026-07-28-001

| Group         | Requirement                                                                   | Outcome                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (KLREQ-020) | canonical terminal key; correct `@kitluy/sync-protocol` under a governed task | **DONE** — `buildTerminalIdempotencyKey`; the `location:…:hub:…:seq:N` form removed with NO alias; sequence is `bigint` so the unsigned 64-bit range cannot lose precision |
| 2 (KLREQ-021) | persisted/wire vocabularies; retire `OutboxItemState`                         | **DONE** — retired; aligned vocabularies exported                                                                                                                          |
| 3 (KLREQ-022) | no `edge_finance` ledger                                                      | **UNCHANGED** — WS-10 added none; assertion still refuses the schema                                                                                                       |
| 4 (KLREQ-023) | additive mechanics ratified                                                   | **UNCHANGED**                                                                                                                                                              |
| 5 (KLREQ-025) | signed grant projection, deny-over-allow, no invented grace period            | **PARTIAL, recorded** — see §5                                                                                                                                             |
| 6 (KLREQ-026) | `kh1.{command_result_uuid}.{event_ordinal}`                                   | **DONE** — `src/hub/effect-contract.ts`; every event now carries `kh1.*`                                                                                                   |
| 7 (KLREQ-027) | no direct provider callbacks; dedupe triple                                   | **DONE** — `edge_sync.provider_outcome_delivery`; contradictions conflict rather than overwrite                                                                            |

---

## 5. Open, recorded — NOT resolved

| Id                       | What is open                                                                                                                    | Current behaviour                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **KLREQ-024**            | Booking status vs the production chain                                                                                          | unchanged; still open                                                                                                                                                                                                                     |
| **KLREQ-028**            | no route/RBAC key for plant production stages                                                                                   | unchanged; still open                                                                                                                                                                                                                     |
| **KLREQ-025 field list** | the approved definition enumerates **21 required fields**; that enumeration is not reproduced verbatim in the decision register | the projection implements the fields the ruling's SEMANTICS require. The remainder are NOT invented to reach the count — guessing an authorization field list would manufacture a contract. Carried as `GRANT_PROJECTION_FIELD_CONTRACT`  |
| **KLREQ-029** (new)      | no RBAC key for an OPERATOR clearing a reconciliation                                                                           | operator path INACTIVE, fails closed. `fleet.sync.trigger` permits REQUESTING a cycle, not DECLARING a divergence resolved, so it is not reused. The governed AUTOMATED path is active because its authority is the signed cloud decision |
| **KLREQ-030** (new)      | no RBAC key for ABANDONING a dead-lettered item                                                                                 | abandonment has NO code path; `resolution_action` CHECKs a list containing only `requeued`, so the database refuses it too                                                                                                                |
| **KLREQ-015**            | nine approved Edge routes still carry no permission key                                                                         | unchanged; those commands stay INACTIVE                                                                                                                                                                                                   |

### Additive extensions owed an amendment to the canonical Hub schema document

| Gap | Relation                                  | Why it exists                                                                                         |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| G9  | `edge_sync.transmission_batch`, `…_item`  | nowhere to record WHAT was signed and WHICH cloud response answered it                                |
| G10 | `edge_sync.provider_outcome_delivery`     | KLREQ-027 requires a dedupe triple, and a dedupe with nowhere to remember what it saw is not a dedupe |
| G11 | `edge_config.permission_grant_projection` | KLREQ-025 requires a local signed grant projection; the §6 catalogue has none                         |

Cloud DD deviations, recorded in the migration header of group 0110: **D1**
`sync_inbox.effect_key` (the ruled dedupe key), **D2** `sync_batches` signature
columns, **D3** `device_heartbeats` and `component_health_snapshots`
deliberately NOT created.

---

## 5a. Independent review findings, and what changed because of them

Review: `00_AI_HANDOFF/reviews/2026-07-28__WS-10-SYNC__REVIEW.md`, verdict
**APPROVED-WITH-CONDITIONS** with two BLOCKING findings. Both were reproduced
independently before any fix was written, and both are now fixed in
`hub/migrations/0024_governed_marker_and_scope_hierarchy.sql`.

| Finding                     | What the reviewer proved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RV-001 (HIGH, blocking)** | The 0015 governed marker was `current_setting('kitluy.reconciliation_governed')` — a custom GUC **any role can set with `set_config()`**. Running as `kitluy_sync_worker`, the reviewer set the marker and cleared a raised reconciliation with a forged authority string, an unrelated correlation event and **zero audit rows**. 0015's own comment claimed "This trigger makes it structural." **It did not.** 0020 closed a different hole (PUBLIC EXECUTE) and did not make the trigger unforgeable. | 0024 moves the gate to the **executing identity**: `raise_reconciliation` and `clear_reconciliation` are SECURITY DEFINER owned by a NOLOGIN, memberless role `kitluy_reconciliation_governor`, and the trigger recognises only that identity. Re-probed: the forge now fails for `kitluy_sync_worker` **and for the database owner**, while the governed path still works. Assertion 29c asserts the role is NOLOGIN, has zero members, and owns both SECURITY DEFINER procedures |
| **RV-002 (HIGH, blocking)** | `resolve_permission_grant` filtered on the **exact** `(scope_type, scope_id)` tuple, so a `deny` at Digital Store scope was invisible when resolving at Location scope. With a live broad deny and a narrow allow, the resolver returned **`allow`**. The column comment claimed "DENY OVERRIDES ALLOW at every scope" — false.                                                                                                                                                                           | 0024 walks the whole chain (platform → tenant → digital_store → store_location, plus the exact tuple for scope types outside it) and a deny anywhere wins. The old signature is DROPPED rather than left callable. Re-probed: the same case now returns `deny`; a broader allow correctly covers a narrower request; offline without a signed policy still returns `unknown`. Assertion 29d covers it                                                                              |
| **RV-005 (evidence)**       | `test:rls` reports **94** cases, not 95; this document's own itemization summed to 94 and so contradicted itself.                                                                                                                                                                                                                                                                                                                                                                                         | Corrected to 94 in §1. The figure was carried forward from earlier cycles' evidence without being recounted                                                                                                                                                                                                                                                                                                                                                                        |

Register entry **C27** previously said "CLOSED", which was true of the PUBLIC
EXECUTE hole and **not** true of the §5 enforcement it was cited for. It now
records both halves, with C30 covering RV-001.

### Re-verification pass

The reviewer re-attacked both fixes (11 probes on RV-001 alone, including the
auto-updatable view, `ON CONFLICT DO UPDATE`, `DISABLE TRIGGER` and the
untriggered INSERT path) and **discharged both blocking conditions**. It then
found two MORE fail-open defects in the same resolver:

| Finding    | What it proved                                                                                                                                                                                                                       | Correction                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RV-013** | A `platform`-scoped **ALLOW** whose `tenant_id`/`digital_store_id` belonged to a DIFFERENT tenant returned `allow`. The resolver never filtered on the grant's own identity columns and the platform branch matched unconditionally. | `0025`: a grant must belong to the tenant, Digital Store and Location being asked about. Re-probed: `unknown`                                                                                                                         |
| **RV-014** | A `tenant`-scoped **DENY with a NULL `scope_id` failed OPEN** — `is not distinct from` is false against a non-NULL request, so the deny was never loaded and a narrow allow won.                                                     | `0025` in two layers: a CHECK makes the row unstorable, and the resolver loads a malformed non-platform DENY anyway so the failure direction stays closed if the CHECK is relaxed. A malformed ALLOW is deliberately still not loaded |

Both were classed NON-BLOCKING because the resolver has no production caller.
They were fixed anyway: both are fail-open defects in an authorization path, and
"no caller yet" describes today rather than the cycle that adds one.

Two further findings are RECORDED rather than fixed, because neither has a
correct fix available in this cycle: **KLRISK-HUB-007** (the §5 immutable audit
is a caller convention, not a database guarantee) and **KLRISK-HUB-008** (the
database owner holds CREATEROLE and can therefore forge the §5 identity —
inherent to PostgreSQL ownership, inside the standing KLRISK-HUB-003 trust
boundary).

**RV-017, unexplained and reported as such:** one of the reviewer's suite runs
exited non-zero and could not be reproduced in six further attempts, including
an exact replay. The failing test could not be identified because the probe's
own output filter discarded it. Nothing was found; nothing is claimed. It is
recorded here because an unreproducible failure is evidence of something, and
suppressing it would be exactly the kind of green-summary reporting this
document is supposed to prevent.

Non-blocking findings (RV-003, RV-004, RV-007 and advisories) are recorded in
§5 and in the decision register; **RV-004 in particular is the honest statement
that WS-10 ships no wired production path** — see §7.

---

## 5b. Divergence from the owner amendment, found and corrected

Found by re-reading KLD-2026-07-28-001-A01 against the running database AFTER
the review had closed. Not found by the reviewer, and not found by the gates —
because the wrong values had been written into the assertions too.

| Ref     | Divergence                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Correction                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C34** | §3 publishes an explicit SIX-value external-status table. The implementation collapsed `in_flight` and `retry_wait` into `pending_cloud_sync` and mapped `dead_letter` to `reconciliation_required` — **three of six rows wrong**. The reasoning was that the approved five-value COMMAND sync-state registry forbade a sixth value; that confused two subjects, since `edge_sync.command_result.sync_state` describes a COMMAND outcome while §3 describes an OUTBOX ROW | `0026` implements §3 verbatim in both the SQL function and `@kitluy/sync-protocol`. `command_result.sync_state` is UNCHANGED. Assertion 29e reproduces the table row by row     |
| **C35** | §2 gives `delivery_state = dead_letter, conflict_state = none` as an explicit valid combination. It was UNREACHABLE: the projection could not return `delivery_failed`, and `dead_letter_outbox_event` REQUIRED a conflict id, forcing the conflict dimension up on every dead letter                                                                                                                                                                                     | `0026` makes the conflict OPTIONAL. The `dead_letter_item` record is still always written, and that — not the conflict dimension — carries the operator obligation §1 describes |
| **C36** | §6 requires a specific set of invalid transitions to fail closed. None were refused; `pending -> acknowledged` succeeded, recording an acknowledgement for a row never transmitted                                                                                                                                                                                                                                                                                        | `0026` adds `enforce_delivery_transition`. `acknowledged` and `rejected` are terminal. Assertion 29e proves the §6 set fails closed                                             |

**How this got past the gates.** The projection assertion checked the output
against the five-value COMMAND registry rather than against §3, so it validated
the implementation against the same mistake the implementation made. An
assertion derived from the code rather than from the ruling cannot catch the
code disagreeing with the ruling. 29e now reproduces the §3 table literally.

---

## 6. Defects and hazards found during this cycle

| Id             | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                       | Disposition                                                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —              | **PUBLIC EXECUTE on every Hub procedure.** PostgreSQL grants EXECUTE to PUBLIC on function creation and a later GRANT does not revoke it, so every `grant execute` in 0013/0015/0016/0019 was decorative. For `clear_reconciliation` this meant amendment §5 was enforced only by the worker choosing not to call it.                                                                                                                         | **FIXED** in `0020`, which also covers the WS-09 procedures in 0013. Assertion 29c locks it shut for all **30** `edge_*` procedures (an earlier draft said 22, counted before the later migrations added their own) |
| —              | **Density assumption, twice.** `unexplainedSequences` (T002) and the first `recover_sync_cursor` (T009) both assumed a stream's `hub_sequence` values are dense. The Hub sequence is ONE allocator for the whole Hub while ordering is per `(location, generation)`, so absent values usually belong to another stream. The first would have reported other streams' sequences as data loss; the second broke contiguity under parallel load. | **FIXED** — the manifest now makes a self-consistency claim only, and contiguity is over the stream's OWN rows. Recorded in both files                                                                              |
| —              | **Test-run idempotence.** The WS-10 suites used a fixed generation base and so inherited the previous run's streams on a second run.                                                                                                                                                                                                                                                                                                          | **FIXED** — `reserveSyncGenerationBlock` with an explicit per-suite slot table                                                                                                                                      |
| —              | **Cross-suite interference.** The configuration suite activated snapshots into the SHARED Location, replacing the active pricing section every command suite reads.                                                                                                                                                                                                                                                                           | **FIXED** — private synthetic Location                                                                                                                                                                              |
| KLRISK-HUB-006 | **`pnpm db:reset` destroys `kitluy_hub_local`.** Both databases share one development cluster. A wrong-order run still prints PASS while skipping 154 tests.                                                                                                                                                                                                                                                                                  | **RECORDED** — gate order is now part of the procedure; evidence must state passed AND skipped counts                                                                                                               |

---

## 7. What WS-10 does NOT establish

- **No cloud↔Hub integration run exists.** The Hub and cloud halves are tested
  separately, against their own databases, with the transport injected. Nothing
  here demonstrates a live signed batch crossing a real network.
- **No wired production path exists** (review finding RV-004). `ingestBatch`,
  `prepareSignedBatch`, `applyBatchResponse` and `resolveGrant` have no
  production callers; `IngestionPorts` and `SignedBatchTransport` have no
  implementations. WS-10 delivers the mechanisms and their guarantees, not a
  running delivery worker. Anyone reading "IMPLEMENTED-IN-DEV" as "the Hub is
  syncing" would be wrong.
- **The §5 separation is not exercised in practice.** All `kitluy_*` roles are
  NOLOGIN and the Hub agent connects as the database owner, so the
  worker-versus-runtime distinction that RV-001 turned on is currently
  structural only. That is real mitigation for the finding and equally real
  evidence that the separation has never run.
- **No production signer exists.** `createProductionBatchSigner` refuses;
  key custody remains `[REQUIRED: ...]` on **BLK-005**.
- **No complete T1→T4 lifecycle is claimed.** KLREQ-024 and KLREQ-028 remain
  open, so a Booking created through Hub commands still cannot reach READY
  through the command surface alone. WS-10 changes nothing about this.
- **Status ceiling: `IMPLEMENTED-IN-DEV`.** Not INTEGRATION-VERIFIED, not
  pilot-ready, not production-ready.
