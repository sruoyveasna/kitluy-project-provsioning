# Cycle 9 — WS-10 synchronization and configuration publication

| Field          | Value                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| Date           | 2026-07-28                                                             |
| Area           | services (Store Hub agent, cloud sync service, shared sync protocol)   |
| Tasks          | WS-10-T000 … WS-10-T010                                                |
| Authority      | `KLD-2026-07-28-001` (Groups 1–7) + amendment `KLD-2026-07-28-001-A01` |
| Scope fence    | `00_AI_HANDOFF/000_ACTIVE_PHASE.md` §8 — WS-10 only                    |
| Base commit    | `ea2f7ce`                                                              |
| Head commit    | `1a9c6af` (8 commits: `6cf713c`..`1a9c6af`)                            |
| Status reached | WS-10 **IMPLEMENTED-IN-DEV** — not INTEGRATION-VERIFIED                |
| Evidence       | `docs/evidence/phase1/ws-10/WS-10-EXECUTION-EVIDENCE.md`               |
| Review         | `00_AI_HANDOFF/reviews/2026-07-28__WS-10-SYNC__REVIEW.md`              |

## Files created / changed

**Hub migrations (additive; 0001 and every earlier applied file untouched):**
`0015_sync_delivery_state_alignment.sql`, `0016_sync_outbox_leasing.sql`,
`0017_sync_transmission_batches.sql`, `0018_hub_effect_keys.sql`,
`0019_sync_delivery_outcomes.sql`, `0020_revoke_public_execute.sql`,
`0021_cloud_inbox_and_provider_outcomes.sql`,
`0022_signed_grants_and_activation.sql`,
`0023_operator_repair_and_recovery.sql`, `0024_governed_marker_and_scope_hierarchy.sql`,
`0025_grant_scope_isolation.sql`, `0026_amendment_projection_and_transitions.sql`.

**Cloud migration:** `supabase/migrations/20260728100110_0110_sync_ingestion.sql`
(creates `kitluy_sync`, already named in DD v1.0.0 — no dictionary amendment
needed for the schema itself; three relation-level deviations recorded in the
file header).

**Hub agent:** `src/hub/sync/{errors,outbox-lease,signing,transmission,delivery-outcome,reconciliation,inbox,configuration,grants,operations}.ts`,
`src/hub/effect-contract.ts`; `outbox.ts`, `command-pipeline.ts`,
`idempotency.ts`, `payment-commands.ts`, `booking-commands.ts`, `local-db.ts`,
`sync-engine.ts`, `open-items.ts`, `hub-database.ts` updated.

**Shared:** `packages/sync-protocol/src/index.ts` rewritten (the KLREQ-020
correction the owner decision required under a governed task).

**Cloud service:** `services/kitluy-sync-service/src/ingestion.ts`.

**Tests added:** `sync-outbox-lease` (17), `sync-transmission` (19),
`sync-delivery-outcome` (17), `sync-reconciliation` (7), `sync-inbox` (15),
`sync-configuration` (17), `sync-operations` (8), `hub-effect-contract` (10),
plus `sync-service/test/ingestion.test.ts` (18) and a rewritten
`sync-protocol.test.ts` (21).

**Seed:** `hub/seed/dev-fixtures.sql` — the applied inbox fixture gains
`verified_at`, so 0021's "verified before applied" CHECK is enforceable from
row zero rather than only for future rows.

## Commands executed (with actual results)

**Gate order matters** — see KLRISK-HUB-006 below.

| Command                | Result                                                  |
| ---------------------- | ------------------------------------------------------- |
| `pnpm db:validate`     | PASS — 18 migration files                               |
| `pnpm db:reset/seed`   | PASS — group 0110 applied                               |
| `pnpm db:test`         | PASS — **124** assertions (121 + 3 new)                 |
| `pnpm test:rls`        | PASS — **94** cases (95 was a miscount carried forward) |
| `pnpm hub:db:validate` | PASS — 27 Hub migration files                           |
| `pnpm hub:db:reset`    | PASS — 27 migrations from zero                          |
| `pnpm hub:db:seed`     | PASS — fixtures seeded                                  |
| `pnpm hub:db:test`     | PASS — **35** assertions                                |
| `pnpm hub:db:status`   | PASS — 27 applied, 0 pending, 0 drift, 0 missing        |
| `pnpm verify`          | **PASS 11/11**                                          |

## Tests: passed / failed / not run

- `@kitluy-services/kitluy-hub-agent` — **274 passed, 2 skipped** (opt-in
  destructive backup/restore, unchanged from WS-09)
- `@kitluy/sync-protocol` — 21 passed
- `@kitluy-services/kitluy-sync-service` — 18 passed
- **Not run:** any cloud↔Hub integration test. None exists. The two halves are
  tested separately with the transport injected.

## Decisions made

None. Every decision implemented here was already ruled by the owner. Where a
ruling was not reproducible verbatim (KLREQ-025's 21-field enumeration), the
gap was recorded rather than filled with a guess.

## Conflicts discovered

- **C34 / C35 / C36 — IMPLEMENTER DIVERGENCE FROM THE OWNER AMENDMENT**, found
  by re-reading KLD-2026-07-28-001-A01 against the running database AFTER the
  independent review had closed. The §3 external-status table was wrong on three
  of six rows; `dead_letter + none` — a state §2 names explicitly — was
  unreachable; and the §6 invalid transitions were not refused. All three CLOSED
  by `0026` and asserted by section 29e. The gates had stayed green because the
  wrong five-value list had been written into the assertion too, so it validated
  the code against the same mistake the code made.
- **Test-environment fragility (corrected).** `pnpm db:reset` recreates the whole
  cluster and so wipes ROLE MEMBERSHIPS. The Hub assertions called the governed
  conflict procedures on a membership an earlier run had left behind; from a
  clean cluster they failed with `permission denied for function
raise_reconciliation` and the suite dropped to 28 — a partial run, not an
  obvious failure. The harness now takes the membership explicitly and section
  29a runs as `kitluy_hub_runtime`.

- **C27** — every Hub stored procedure was EXECUTE-able by PUBLIC (a PostgreSQL
  creation default a later GRANT does not revoke). Amendment §5 was, for one
  migration, enforced only by the delivery worker choosing not to call
  `clear_reconciliation`. **CLOSED** by 0020; assertion 29c locks it shut.
- **C28** — a per-stream density assumption, found twice (batch manifest, then
  cursor recovery). The Hub sequence is one allocator for the whole Hub while
  ordering is per stream. **CLOSED**; both sites now state the finding in place.
- **C29** — KLREQ-025's 21-field enumeration is not in the register. **OPEN** as
  a required value.

## Required values discovered

- **KLREQ-029** — no RBAC key for an OPERATOR clearing a reconciliation. The
  operator path is INACTIVE and fails closed; `fleet.sync.trigger` is NOT
  reused, because requesting a retry and declaring a divergence resolved are
  different acts.
- **KLREQ-030** — no RBAC key for ABANDONING a dead-lettered item. Abandonment
  has no code path at all, and the database refuses it too.
- **KLREQ-025 field list** — carried as `GRANT_PROJECTION_FIELD_CONTRACT`.
- **Production batch signing** — `[REQUIRED: ...]` on BLK-005;
  `createProductionBatchSigner` refuses rather than falling back to the
  development HMAC signer.

## Security findings

1. **PUBLIC EXECUTE on all Hub procedures** (C27; 30 by the assertion's own count) — fixed in 0020, covering
   the WS-09 procedures too, and asserted.
2. The development batch signer has **no default key**, demands ≥32 bytes, and
   refuses to run outside `KITLUY_ENV=local|development`. No key material is
   stored in the database or in source; `pnpm secret:scan` passes.
3. Cloud `kitluy_sync` relations are RLS ENABLE+FORCE with SELECT-only client
   policies and **zero anon policies**, asserted in cloud section 27.
4. No provider secret reaches the Hub: provider signature verification stays in
   the cloud, and the Hub verifies only the CLOUD's signature on the delivery.

## Known limitations

- **No cloud↔Hub integration run exists.** NOT INTEGRATION-VERIFIED.
- **No production signer.** BLK-005 still blocks it.
- **No complete T1→T4 lifecycle is claimed.** KLREQ-024 and KLREQ-028 remain
  open; WS-10 changes nothing about that.
- **KLRISK-HUB-006 (new)** — `pnpm db:reset` destroys `kitluy_hub_local`. A
  wrong-order gate run reported 109 passed / 154 SKIPPED while still printing
  PASS. Evidence citing Hub-backed counts must state passed AND skipped.
- **KLRISK-HUB-007 / KLRISK-HUB-008 (new, from the review)** — the §5 immutable
  audit is a CALLER convention rather than a database guarantee, and the
  database owner can still forge the §5 identity (inside the KLRISK-HUB-003
  trust boundary).
- **No wired production path** (review RV-004): the delivery functions have no
  production callers and the ports have no implementations.
- Carried unchanged: KLRISK-HUB-001..005.

## Current implementation status (evidence register delta)

`WS-10 synchronization and configuration publication` — **SCAFFOLDED →
IMPLEMENTED-IN-DEV** (2026-07-28), with the material limitations above recorded
in the row itself.

## Recommended next task

The owner's call, but in dependency order:

1. **Rule KLREQ-029 and KLREQ-030** — both are small, both currently fail
   closed, and both block real operator workflows.
2. **Supply KLREQ-025's verbatim 21-field enumeration** so the grant projection
   can be completed additively.
3. **WS-11 device provisioning / BLK-005 PKI** — the production batch signer
   cannot exist until the PKI design does, and until then WS-10 cannot be
   integration-verified with real signatures.
4. **Rule KLREQ-024 and KLREQ-028 together** — until then no complete T1→T4
   lifecycle may be claimed, regardless of how much of the surface is built.
