# Unresolved Conflicts

**Filename:** `09_UNRESOLVED_CONFLICTS.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** CURRENT — **all items require owner decisions**
**Authority:** REFERENCE (records conflicts; resolves none)

> No conflict below was resolved by inference. Mission §3: _"Never invent the resolution."_

## BLOCKER-1 — WS-12 locked task register (governs everything)

|                    |                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authority**      | `KLD-2026-08-06-WS12-TASKS-001` — `docs/decisions/kitluy-ws12-t1-intake-cashier-task-register-owner-decision-v1.0.0.md`                                                |
| **Constraint**     | Eight tasks, **order and count locked**. T001 ✅, T002 ✅, **T003–T008 NOT STARTED**                                                                                   |
| **Fence**          | _"T1 still creates no Booking, pricing, payment, receipt or printing."_ Composition rule: T1 is not a new source of Booking, payment, pricing, customer or audit truth |
| **Effect**         | The mission's M01–M20 sequence maps onto T003–T008. Executing it independently bypasses a locked owner register                                                        |
| **Owner question** | Should POS consolidation run **as inputs to WS-12 T003–T008 in their locked order**, or does a new owner decision supersede the register?                              |
| **Status**         | **UNRESOLVED — blocks all feature migration**                                                                                                                          |

## BLOCKER-2 — KLDRV-CONF-001: vocabulary and domain model

|                                  |                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Sources**                      | Drive `KLDRV-0001` (OWNER-LOCKED, 2026-07-18): **Order → Service → Service Item** (`pos.orders`, `pos.order_items`, `laundry.garments`, `catalog.services`) — implemented across the laundry POS |
| **Versus**                       | Canonical monorepo: **Laundry Booking** (`booking-lifecycle`, `custody-events`, WS-12 booking drafts, cloud migration 0187)                                                                      |
| **Why unresolvable by analysis** | Both are owner authority at the same level, scoped to different repositories. Neither states which governs the monorepo                                                                          |
| **Blast radius**                 | Schema, API contracts, events, audit records, receipts. Expensive to reverse after migrations                                                                                                    |
| **Blocks**                       | F-30 catalog, F-40 intake, F-41 order model, F-42 garments, and every dependent test                                                                                                             |
| **Owner question**               | Does `KLDRV-0001` (a) apply only to the legacy repository, (b) stand superseded by the monorepo T1/Booking decisions, or (c) require reconciliation into one vocabulary?                         |
| **Status**                       | **UNRESOLVED**                                                                                                                                                                                   |

## BLOCKER-3 — KLDRV-CONF-003: which POS repository is the base

|                    |                                                                                                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Candidates**     | `kitluy-laundry-pos-desk-app` — 285 files, real T1 (64 files), printing, payments, hardware, but **cloud-direct** and Electron 40 / TS 5.6                                                     |
|                    | `kitluy-suite-pos-desk-app` — 113 files, thin (`auth`, `terminals` only), dominated by **café/restaurant** (tabs 39, tables 30, floor 14), React 19 / Vite 8 / TS 6                            |
| **New evidence**   | The suite repo's 3 unpushed commits port _laundry_ UI _into_ the suite shell — a consolidation direction was already being explored. Recorded as evidence; it does **not** decide the conflict |
| **Complication**   | The canonical `apps/kitluy-pos-desktop-app` is neither — it is a Hub-mediated fail-closed scaffold with live WS-12 T1 work, architecturally opposite to both                                   |
| **Owner question** | Is the base (a) the canonical scaffold with both sources as reference, (b) the laundry POS, or (c) the suite shell with laundry features ported in?                                            |
| **Status**         | **UNRESOLVED — blocks shell, routing and shared-UI units**                                                                                                                                     |

## BLOCKER-4 — KLDRV-CONF-004: Supabase migration lineage

|                  |                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| **Sources**      | `kitluy-suite-supabase`: **21** migrations · canonical `supabase/migrations/`: **86 `.sql`**           |
| **Unknown**      | Whether the 21 are ancestors, a parallel lineage, or superseded                                        |
| **Risk**         | Schema divergence or data loss; duplicate migration numbers; replaying historical migrations           |
| **Constraint**   | **Never auto-apply production migrations** (OWNER-LOCKED `KL-INF-P1-037`)                              |
| **Owner action** | Authorize a read-only per-environment applied-migration comparison                                     |
| **Status**       | **UNRESOLVED — highest data risk; blocks all `supabase/` work and `kitluy-suite-supabase` retirement** |

## BLOCKER-5 — Architectural inversion (technical, not a decision)

**84 of 285** laundry POS source files access Supabase directly; the canonical
architecture requires `Digital Store → Store Hub → T1–T4` with terminals never
writing to Supabase. Mission §16 forbids preserving that coupling.

This is not an owner decision — it is a re-implementation cost. It means no
data-touching feature is a port. Recorded so the effort is not underestimated.

## BLOCKER-6 — Toolchain reconciliation

Electron **33 (catalog) vs 40 (both sources)**; React 19.2.6 and Vite 8 and
TS 6.0 in the suite POS. Main-process and preload compatibility cannot be
assumed. **Owner/architect decision required** on whether the catalog moves or
the sources are down-levelled.

## Secondary unresolved items

| ID      | Item                                                                                                      | Status     |
| ------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| F-15    | Shift / cash-drawer authority — implemented in laundry POS, unassigned in canonical docs                  | UNRESOLVED |
| F-36    | Discounts and tax — not evidenced in either source                                                        | UNRESOLVED |
| F-55    | Shift report ownership — depends on F-15                                                                  | UNRESOLVED |
| F-66    | Rewash / damage — neither source implements                                                               | UNRESOLVED |
| F-63/64 | T3 (2 files) and T4 (1 file) are scaffold-level in the source; no usable implementation exists to migrate | Recorded   |

## Pre-existing blockers (carried, not re-adjudicated)

**KLREQ-001** Supabase documentation pack incomplete · **KLREC-2026-07-26-001**
`/edge/v1` route fork blocks Hub business routes · **KLREQ-007** owner
documentation-program instruction never supplied ·
**KLREC-2026-07-26-009..013** contract/code drifts.

## Consequence

**Zero migration units may proceed today.** BLOCKER-1 gates the sequencing;
BLOCKER-2 and -3 gate the semantics; BLOCKER-4 gates the data. All safe
non-code work has been completed instead.
