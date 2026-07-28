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

| #   | Gate             | Command                                  | Result                                                               |
| --- | ---------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| 1   | Cloud static     | `pnpm db:validate`                       | **PASS** — 18 migration files                                        |
| 2   | Cloud from zero  | `pnpm db:reset` → `pnpm db:seed`         | **PASS** — group 0110 applied                                        |
| 3   | Cloud assertions | `pnpm db:test`                           | **PASS** — **124** `NOTICE: PASS` (121 before + 3 new in section 27) |
| 4   | Cloud RLS        | `pnpm test:rls`                          | **PASS** — 95 cases (14+9 baseline, WS5 14, WS6 19, WS7 19, WS8 19)  |
| 5   | Hub static       | `pnpm hub:db:validate`                   | **PASS** — 24 Hub migration files                                    |
| 6   | Hub from zero    | `pnpm hub:db:reset` → `pnpm hub:db:seed` | **PASS** — 24 migrations applied, fixtures seeded                    |
| 7   | Hub assertions   | `pnpm hub:db:test`                       | **PASS** — **32** `NOTICE: PASS` (29 at WS-09 close + 3 new)         |
| 8   | Hub journal      | `pnpm hub:db:status`                     | **PASS** — 24 applied, 0 pending, 0 checksum drift, 0 missing        |
| 9   | Repository       | `pnpm verify`                            | **PASS — 11/11**                                                     |

Counting command for gate 7, pinned in code as `HUB_DB_ASSERTION_CONTRACT`:

```bash
pnpm hub:db:test | grep -c "NOTICE:  PASS"
```

`grep -c PASS` also matches the runner's own summary line and reports one too
many. A count derived from the summary line is never reported.

### Suite counts

| Suite                                  | Result                                                     |
| -------------------------------------- | ---------------------------------------------------------- |
| `@kitluy-services/kitluy-hub-agent`    | **261 passed, 2 skipped** (22 files: 21 passed, 1 skipped) |
| `@kitluy/sync-protocol`                | **21 passed**                                              |
| `@kitluy-services/kitluy-sync-service` | **18 passed**                                              |
| `pnpm verify` unit gate                | **PASS** across 60 workspace tasks                         |

The 2 skipped hub-agent tests are the opt-in destructive backup/restore suite
(`KITLUY_HUB_DESTRUCTIVE_TESTS=1`, run alone) — unchanged from WS-09.

**Caveat recorded rather than buried:** an earlier evidence run reported
`109 passed / 154 skipped` for the hub-agent suite. That run followed the cloud
reset without rebuilding the Hub database, so every DB-backed suite skipped. It
is NOT cited as evidence anywhere; the 261/2 figures above come from a run with
a live Hub database.

---

## 2. What was built, per task

| Task | Deliverable                                | Evidence                                                                                                                                                        |
| ---- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T000 | Additive state alignment (A01)             | `hub/migrations/0015_sync_delivery_state_alignment.sql`; assertions 29a/29b                                                                                     |
| T001 | Outbox leasing, `pending → in_flight`      | `0016_sync_outbox_leasing.sql`; `src/hub/sync/outbox-lease.ts`; `test/sync-outbox-lease.test.ts` 17/17                                                          |
| T002 | Signed Hub→cloud transmission              | `0017_sync_transmission_batches.sql`; `src/hub/sync/{signing,transmission}.ts`; `test/sync-transmission.test.ts` 19/19; `@kitluy/sync-protocol` corrected       |
| T003 | Idempotent cloud ingestion, `kh1.*`        | `0018_hub_effect_keys.sql`; `supabase/migrations/…0110_sync_ingestion.sql`; `src/hub/effect-contract.ts`; `kitluy-sync-service/src/ingestion.ts`; 18 + 10 tests |
| T004 | Ack, rejection, retry/backoff, dead-letter | `0019_sync_delivery_outcomes.sql`; `src/hub/sync/delivery-outcome.ts`; `test/sync-delivery-outcome.test.ts` 17/17                                               |
| T005 | Independent dimensions, governed clearance | `0020_revoke_public_execute.sql`; `src/hub/sync/reconciliation.ts`; `test/sync-reconciliation.test.ts` 7/7; assertion 29c                                       |
| T006 | Cloud→Hub delivery, provider outcomes      | `0021_cloud_inbox_and_provider_outcomes.sql`; `src/hub/sync/inbox.ts`; `test/sync-inbox.test.ts` 15/15                                                          |
| T007 | Signed grant + snapshot publication        | `0022_signed_grants_and_activation.sql`; `src/hub/sync/{grants,configuration}.ts`                                                                               |
| T008 | Verification, atomic activation, rollback  | same migration; `test/sync-configuration.test.ts` 17/17                                                                                                         |
| T009 | Cursor recovery, health, operator repair   | `0023_operator_repair_and_recovery.sql`; `src/hub/sync/operations.ts`; `test/sync-operations.test.ts` 8/8                                                       |

---

## 3. Amendment KLD-2026-07-28-001-A01 — clause by clause

| Clause                                   | Where it is enforced                                                                                                                      | Test                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| §2 canonical delivery states             | `0015` `ALTER TYPE … RENAME VALUE` (member OIDs preserved, so 0009/0012/0013 constraints, indexes and views keep working)                 | assertion 29a; `sync-protocol.test.ts`       |
| §2 `rejected` is DURABLE                 | `edge_sync.is_durable_rejection_code` in the DB; `reject_outbox_event` refuses anything else; `defer_outbox_event` refuses a durable code | `sync-delivery-outcome.test.ts`              |
| §2 no fabricated acknowledgement         | 0009 `outbox_ack_ck` (unchanged) + `acknowledge_outbox_event` requires the cloud ack id and a matching lease                              | `sync-delivery-outcome.test.ts`              |
| §3 orthogonal conflict dimension         | `edge_sync.reconciliation_state` is a SEPARATE type; `reconciliation_required` is absent from `delivery_state`                            | assertion 29b                                |
| §3 independent transitions               | `enforce_state_dimension_independence` refuses one statement moving both                                                                  | assertion 29a; `sync-reconciliation.test.ts` |
| §4 ONE shared projection, conflict first | `@kitluy/sync-protocol.projectExternalSyncStatus` + `edge_sync.external_sync_status`, held equal over the whole cross product             | `sync-transmission.test.ts` conformance test |
| §5 worker may not clear                  | governed-marker trigger + `0020` revoking PUBLIC EXECUTE; `clear_reconciliation` granted to `kitluy_hub_runtime` only                     | assertion 29c; `sync-reconciliation.test.ts` |
| §5 authority, reason, correlation, audit | 0015 CHECK constraints + `src/hub/sync/reconciliation.ts` writing the immutable audit row in the same transaction                         | `sync-reconciliation.test.ts`                |

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

## 6. Defects and hazards found during this cycle

| Id             | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                       | Disposition                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| —              | **PUBLIC EXECUTE on every Hub procedure.** PostgreSQL grants EXECUTE to PUBLIC on function creation and a later GRANT does not revoke it, so every `grant execute` in 0013/0015/0016/0019 was decorative. For `clear_reconciliation` this meant amendment §5 was enforced only by the worker choosing not to call it.                                                                                                                         | **FIXED** in `0020`, which also covers the WS-09 procedures in 0013. Assertion 29c locks it shut for all 22 `edge_*` procedures        |
| —              | **Density assumption, twice.** `unexplainedSequences` (T002) and the first `recover_sync_cursor` (T009) both assumed a stream's `hub_sequence` values are dense. The Hub sequence is ONE allocator for the whole Hub while ordering is per `(location, generation)`, so absent values usually belong to another stream. The first would have reported other streams' sequences as data loss; the second broke contiguity under parallel load. | **FIXED** — the manifest now makes a self-consistency claim only, and contiguity is over the stream's OWN rows. Recorded in both files |
| —              | **Test-run idempotence.** The WS-10 suites used a fixed generation base and so inherited the previous run's streams on a second run.                                                                                                                                                                                                                                                                                                          | **FIXED** — `reserveSyncGenerationBlock` with an explicit per-suite slot table                                                         |
| —              | **Cross-suite interference.** The configuration suite activated snapshots into the SHARED Location, replacing the active pricing section every command suite reads.                                                                                                                                                                                                                                                                           | **FIXED** — private synthetic Location                                                                                                 |
| KLRISK-HUB-006 | **`pnpm db:reset` destroys `kitluy_hub_local`.** Both databases share one development cluster. A wrong-order run still prints PASS while skipping 154 tests.                                                                                                                                                                                                                                                                                  | **RECORDED** — gate order is now part of the procedure; evidence must state passed AND skipped counts                                  |

---

## 7. What WS-10 does NOT establish

- **No cloud↔Hub integration run exists.** The Hub and cloud halves are tested
  separately, against their own databases, with the transport injected. Nothing
  here demonstrates a live signed batch crossing a real network.
- **No production signer exists.** `createProductionBatchSigner` refuses;
  key custody remains `[REQUIRED: ...]` on **BLK-005**.
- **No complete T1→T4 lifecycle is claimed.** KLREQ-024 and KLREQ-028 remain
  open, so a Booking created through Hub commands still cannot reach READY
  through the command surface alone. WS-10 changes nothing about this.
- **Status ceiling: `IMPLEMENTED-IN-DEV`.** Not INTEGRATION-VERIFIED, not
  pilot-ready, not production-ready.
