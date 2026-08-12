# POS Migration Plan

**Filename:** `07_POS_MIGRATION_PLAN.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** CURRENT · **Authority:** APPROVED-TARGET

## 1. Governing relationship with WS-12

Owner decision 2026-08-07 §6: consolidation may proceed, but

```text
MIGRATED CODE  ≠  TASK COMPLETED
```

A migrated unit is `MIGRATED-NOT-YET-ACCEPTED` until the corresponding locked
WS-12 task passes its own acceptance, tests, independent review and evidence
gate. T003–T008 remain NOT STARTED and are not advanced by this mission.

## 2. Unit status

| Unit    | Scope                                                      | WS-12 acceptance owner    | Status                                                    |
| ------- | ---------------------------------------------------------- | ------------------------- | --------------------------------------------------------- |
| **P00** | **Vertical resolver + registry + module registration**     | none (shell architecture) | ✅ **BUILT — MIGRATED-NOT-YET-ACCEPTED**                  |
| P01     | Application shell comparison                               | T007                      | Analysed (`05`)                                           |
| P02     | Electron main / preload / IPC                              | T007                      | Canonical retained; donors superseded                     |
| P03     | Device and session runtime                                 | **T001 complete**         | Canonical retained                                        |
| P04     | Store Hub client                                           | **T001 complete**         | Canonical retained                                        |
| P05     | Shared design / UI primitives                              | T007                      | Gated — React 19 → 18.3.1 first                           |
| P06     | Shared navigation / routing                                | T007                      | Gated                                                     |
| P07     | Shared hardware abstractions                               | T006                      | Ready — donor `hardware/` is portable                     |
| P08     | Shared printing                                            | T005/T006                 | Ready — builders + raster + 2 transports                  |
| P09     | Scanner / scale support                                    | T006                      | Ready — `scanner-service`                                 |
| P10     | Customer identity                                          | **T002 complete**         | Canonical retained                                        |
| P11     | Laundry catalog / service selection                        | T003                      | Gated — KLDRV-CONF-001                                    |
| P12     | Laundry intake                                             | T003                      | Gated — KLDRV-CONF-001                                    |
| P13     | Piece / weight entry                                       | T003                      | Gated                                                     |
| P14     | Garment / condition flow                                   | T003                      | Gated                                                     |
| P15     | Laundry pricing                                            | T004                      | Gated — `express.ts` portable once vocabulary settles     |
| P16     | Deposits / payment / KHQR                                  | T005                      | Gated — finance semantics                                 |
| P17     | Receipt / tag printing                                     | T005                      | Gated                                                     |
| P18     | Laundry production / ready                                 | —                         | Canonical superior — SUPERSEDE                            |
| P19     | Laundry pickup                                             | post-T007                 | Donor insufficient (1 file)                               |
| P20     | T2/T3/T4 support                                           | post-T007                 | T2 canonical; T3/T4 donors insufficient                   |
| P21–P26 | Café shared catalog, cart, ordering, tables, KDS, payments | Phase 2                   | **REGISTER-INACTIVE** — boundary built, code not migrated |
| P27     | Shared test consolidation                                  | per task                  | Partial — 30 new tests added                              |
| P28     | Dead / duplicate code removal                              | after migration           | Not started                                               |

## 3. Remaining prerequisites

| #   | Prerequisite                                                         | Blocks                               | Owner or engineering                |
| --- | -------------------------------------------------------------------- | ------------------------------------ | ----------------------------------- |
| P1  | **KLDRV-CONF-001** — Order/Service/Service Item vs Booking           | P11–P14, and the schema beneath them | **OWNER**                           |
| P2  | **KLDRV-CONF-004** — 21 vs 86 migration lineage                      | anything touching `supabase/`        | **OWNER**                           |
| P3  | Toolchain reconciliation — Electron 33 vs 40; React 19; Vite 8; TS 6 | P05, P06, P21–P26                    | Engineering, per §21 canonical wins |
| P4  | Core-neutrality split for `lib/printing`, `lib/pricing`              | P08, P15                             | Engineering                         |
| P5  | Data-boundary rewrite for 84 donor files                             | P11–P17                              | Engineering, per §20                |

**KLDRV-CONF-003 is RESOLVED** by owner decision §5. **BLOCKER-1 (WS-12 lock) is
RESOLVED** by §6 via `MIGRATED-NOT-YET-ACCEPTED`.

## 4. Recommended next unit

**P07/P08/P09 — hardware, printing and scanning adapters.**

Highest-value genuinely portable assets, no business-semantics conflict, no
data-authority coupling, and canonical homes already exist (`@kitluy/printing`,
`@kitluy/hardware`). Acceptance belongs to WS-12 T006.

## 5. Per-unit procedure

Before: source · target · dependencies · canonical contract · tests · rollback.
Then: port behaviour, not the data layer → adapt to Hub/governed-API contracts →
convert money to `@kitluy/money` → split neutral vs vertical → port or rewrite
tests → record traceability in `08`.
After: `typecheck` · `lint` · unit · contract · offline where applicable →
compare against `00_BASELINE.md`; no new failure without explicit identification.
