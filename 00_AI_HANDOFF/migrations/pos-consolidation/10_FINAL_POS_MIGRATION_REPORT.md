# Final POS Migration Report

**Filename:** `10_FINAL_POS_MIGRATION_REPORT.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** CURRENT · **Authority:** IMPLEMENTATION-EVIDENCE
**Outcome:** **Reconciliation complete · code migration BLOCKED · nothing deleted**

## 1. What was delivered

| Deliverable                                               | State                                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Verified recovery pack for all 6 standalone repositories  | **COMPLETE** — 6 bundles all `is okay`; restore test proved the 3 unpushed commits recoverable and the staged patch applies cleanly |
| Migration baseline                                        | **COMPLETE**                                                                                                                        |
| Laundry POS inventory (285 files)                         | **COMPLETE**                                                                                                                        |
| Suite POS inventory (113 files)                           | **COMPLETE**                                                                                                                        |
| Target monorepo inventory                                 | **COMPLETE**                                                                                                                        |
| Feature reconciliation matrix — 50 feature IDs classified | **COMPLETE**                                                                                                                        |
| Architecture deltas                                       | **COMPLETE**                                                                                                                        |
| Migration plan mapped to the locked WS-12 register        | **COMPLETE**                                                                                                                        |
| Test reconciliation                                       | **COMPLETE**                                                                                                                        |
| Unresolved conflicts                                      | **COMPLETE — 6 blockers**                                                                                                           |
| **Code migration**                                        | **NOT PERFORMED — blocked**                                                                                                         |
| **Standalone retirement**                                 | **NOT PERFORMED — blocked**                                                                                                         |

## 2. Why no code moved

Three independent gates, any one of which is sufficient:

1. **Locked owner task register.** `KLD-2026-08-06-WS12-TASKS-001` fixes eight
   WS-12 tasks in order; T003–T008 are NOT STARTED. The fence states _"T1 still
   creates no Booking, pricing, payment, receipt or printing."_ The mission's
   M01–M20 sequence is those tasks. Executing it independently bypasses the
   register.

2. **Unresolved business semantics.** KLDRV-CONF-001 (Order/Service/Service Item
   vs Booking) and KLDRV-CONF-003 (which POS is the base) sit directly under the
   intake, catalog, order-model and shell units. Mission §3 requires stopping the
   unit and recording the conflict.

3. **Architectural inversion.** 84 of 285 laundry POS files write to Supabase
   directly; canonical terminals must never do so. Mission §16 forbids preserving
   that coupling — so these are re-implementations, not migrations, and they
   belong inside their WS-12 tasks.

## 3. Findings worth the owner's attention

- **The laundry POS is the substantive Phase 1 source** (285 files, T1 = 64
  files, real printing/payments/hardware) — but **T3 (2 files) and T4 (1 file)
  are scaffold-level**. There is no usable T3/T4 implementation to migrate.
- **The suite POS is thin and mostly Phase 2** — `features/` holds only `auth`
  and `terminals`; its bulk is tabs (39), tables (30), floor plans (14), KDS.
  Classified `REFERENCE-FUTURE`; Phase 2 was not activated.
- **The canonical scaffold is architecturally opposite to both sources** —
  Hub-mediated, zero Supabase clients, protected non-selectable terminal
  identity, durable outbox. In several areas the canonical implementation is
  **stricter** and migrating the source would regress a locked security property
  (notably terminal selection).
- **Genuinely portable assets exist** — printing builders and raster, two
  transports, scanner service, USB printer, express pricing, numbering, design
  tokens, OSK. All gated behind WS-12 T004/T005/T006.

## 4. Verification

Run at the canonical root on the repository's own Node 22.23.0 / pnpm 9.15.9.

| Suite              | Baseline         | Final            | Delta         |
| ------------------ | ---------------- | ---------------- | ------------- |
| `pnpm verify`      | 10 PASS / 3 FAIL | 10 PASS / 3 FAIL | **no change** |
| `pnpm docs:verify` | 7 PASS / 1 FAIL  | 7 PASS / 1 FAIL  | **no change** |
| `pnpm secret:scan` | PASS (1,458)     | PASS (1,458)     | **no change** |

**No new failures introduced.** The three pre-existing failures are unchanged:
device-identity integration tests need a KitLuy local Postgres (ports 54321–54324
belong to `e-menu-platform`); 48 pre-existing prettier files; 4 bare-UUID links.

## 5. Recommended next step

Resolve **BLOCKER-1** first — it determines whether consolidation runs inside the
WS-12 register or under a new decision. Then **KLDRV-CONF-001**, then
**KLDRV-CONF-003**. With those three settled, WS-12 T003 can start and consume
the laundry POS as its evidence source under `06_MIGRATION_PLAN.md`.

The single best first code unit once T006 is reached is **printing + scanning
hardware adapters** — highest value, no semantics conflict, no data coupling,
existing homes in `@kitluy/printing` and `@kitluy/hardware`.
