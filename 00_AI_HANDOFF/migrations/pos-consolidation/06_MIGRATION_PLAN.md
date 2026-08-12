# Migration Plan

**Filename:** `06_MIGRATION_PLAN.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** CURRENT — **execution blocked; plan is ready**
**Authority:** APPROVED-TARGET (plan) — not an authorization to build

## 1. Governing constraint

POS feature work is governed by owner decision **`KLD-2026-08-06-WS12-TASKS-001`**,
which locks eight WS-12 tasks **in order and count**. T001 and T002 are complete;
**T003 is NOT STARTED**.

The mission's proposed sequence M01–M20 maps almost exactly onto WS-12 T003–T008.
Executing it independently would **bypass a locked owner task register** — the
one thing `CLAUDE.md` and `AGENTS.md` most explicitly forbid.

**Therefore migration is re-expressed as inputs to the existing WS-12 tasks, not
as a parallel workstream.**

## 2. Mapping — mission units to the locked register

| Mission unit                     | WS-12 task                        | Status                           | Source material                               |
| -------------------------------- | --------------------------------- | -------------------------------- | --------------------------------------------- |
| M01 Electron/app shell           | (outside WS-12; T007 integration) | Gated                            | Suite `electron/`, laundry `main.ts`/`osk.ts` |
| M02 Shared desktop config        | T007                              | Gated                            | Both                                          |
| M03 Auth/session                 | **T001 COMPLETE**                 | Done canonically                 | `SUPERSEDE` sources                           |
| M04 Store/Location resolution    | **T001 COMPLETE**                 | Done canonically                 | `SUPERSEDE` sources                           |
| M05 Shared UI primitives         | T007                              | Gated                            | Suite `shared/`, suite commit `2c83025`       |
| M06 Catalog/service presentation | **T003**                          | **NOT STARTED** + KLDRV-CONF-001 | Laundry `catalog.service`, `serviceCatalog`   |
| M07 Customer identity            | **T002 COMPLETE**                 | Done canonically                 | `KEEP-MONOREPO`                               |
| M08 Laundry Booking/intake       | **T003**                          | **NOT STARTED** + KLDRV-CONF-001 | Laundry `t1-pos` (64 files)                   |
| M09 Pricing                      | **T004**                          | NOT STARTED                      | `lib/pricing/express.ts`                      |
| M10 Deposits/payment/KHQR        | **T005**                          | NOT STARTED                      | ABA PayWay (25), KHQR (10)                    |
| M11 Receipts/tags/printing       | **T005 / T006**                   | NOT STARTED                      | `lib/printing/`                               |
| M12 Garment custody              | **T003**                          | NOT STARTED                      | `data/laundry`, `features/storage`            |
| M13 Production/ready             | canonical exists                  | `KEEP-MONOREPO`                  | `production-state-machine`                    |
| M14 T2 display                   | canonical exists                  | `KEEP-MONOREPO`                  | `t2-display-state-machine`                    |
| M15 T3 scan-in                   | post-T007                         | Source insufficient (2 files)    | —                                             |
| M16 T4 scan-out                  | post-T007                         | Source insufficient (1 file)     | —                                             |
| M17 Offline/Hub comms            | **T006**                          | NOT STARTED                      | Canonical is authoritative                    |
| M18 Device/hardware adapters     | **T006**                          | NOT STARTED                      | `hardware/`, printing transports              |
| M19 Localization                 | **T007**                          | NOT STARTED                      | 8 Khmer files                                 |
| M20 Tests and fixtures           | per task + T008                   | Gated                            | 27 laundry test files                         |

## 3. Prerequisites before any code moves

| #   | Prerequisite                                                                  | Blocks                                      |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------- |
| P1  | Owner resolves **KLDRV-CONF-001** (Order/Service/Service Item vs Booking)     | M06, M08, M12 — and the schema beneath them |
| P2  | Owner resolves **KLDRV-CONF-003** (which POS repo is the base)                | M01, M04(routing), M05                      |
| P3  | Owner authorizes **KLDRV-CONF-004** analysis (21 vs 86 migrations)            | anything touching `supabase/`               |
| P4  | WS-12 **T003** starts under its own task record                               | M06, M08, M12                               |
| P5  | Toolchain reconciliation decision (Electron 33 vs 40; React 19; Vite 8; TS 6) | every desktop unit                          |
| P6  | Core-neutrality split plan for `lib/printing`, `lib/pricing`                  | M09, M11                                    |

**P1–P4 are owner decisions. They cannot be inferred from code.**

## 4. Per-unit procedure (when a unit is unblocked)

Before: identify source · identify target · identify dependencies · identify the
canonical contract · identify tests · define rollback.

Then: port behaviour (not the data layer) → adapt to Hub/governed-API contracts →
convert money to `@kitluy/money` → split neutral vs vertical → port or rewrite
tests → record source traceability in code comments.

After: `pnpm typecheck` · `pnpm lint` · unit tests · contract tests · offline
tests where applicable · compare against the `00_BASELINE.md` result — **no new
failure without explicit identification**.

## 5. Recommended first unit once unblocked

**F-56 / F-72 — printing and scanning hardware adapters (WS-12 T006).**

Rationale: highest-value genuinely portable assets (thermal/USB printing with
raster and two transports; scanner service), no business-semantics conflict, no
data-authority coupling, and existing homes (`@kitluy/printing`,
`@kitluy/hardware`). It is nevertheless gated behind T006 and must run inside
that task, not ahead of it.

## 6. Explicitly out of scope

Phase 2 café/restaurant activation · copying standalone migrations · preserving
direct-Supabase coupling · migrating terminal selection · pushing · rewriting
history · marking anything IMPLEMENTED without evidence.
