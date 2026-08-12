# POS Consolidation Report

**Filename:** `13_POS_CONSOLIDATION_REPORT.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** CURRENT · **Authority:** IMPLEMENTATION-EVIDENCE
**Outcome:** **Vertical-aware shell BUILT · donor feature migration GATED · standalone repositories RETAINED**

## 1. What the owner decision unblocked

Two blockers from the previous cycle are now resolved by owner authority:

| Blocker                                    | Resolution                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **KLDRV-CONF-003** — which POS is the base | §5: **canonical `apps/kitluy-pos-desktop-app` is the base**; both standalone apps are donors                    |
| **WS-12 register lock**                    | §6: consolidation may proceed; migrated code is `MIGRATED-NOT-YET-ACCEPTED` and does not mark any task complete |

That made real architectural work possible, and it was done.

## 2. What was built

**The vertical-aware POS shell** — the capability the canonical application was
missing, and the centre of the owner's architecture:

```text
ONE app → Shared Shell → Vertical Resolver → Vertical Registry
                                    ├── Laundry            ACTIVE_PHASE1
                                    └── Café/Restaurant    REGISTERED_INACTIVE_PHASE2
```

- `@kitluy/digital-store-context` advanced **SCAFFOLDED → implemented**: authoritative, fail-closed vertical resolution with six refusal codes. **16 tests.**
- `apps/kitluy-pos-desktop-app/src/vertical/` — module contract, immutable registry with fail-closed `resolve()`, and explicit module registration. **14 tests.**
- All four owner-locked `laundry.t{1..4}.*` profiles registered; the same installed application becomes the correct terminal purely from Hub-signed assignment.
- Café/restaurant registered as a **Phase 2 boundary**, with two independent gates preventing it loading as Phase 1.

**Nothing was invented.** `VerticalKey`, `VERTICAL_PHASES` and `PHASE_GATES`
already existed and were reused, exactly as §17 requires.

## 3. Honest limits

- **No donor source file was copied.** Neither donor contains vertical _resolution_ — both are single-vertical applications with user-selectable terminal pickers the canonical model forbids. There was nothing to port for this unit.
- **Donor feature migration did not happen.** Intake, pricing, payment, receipts, printing and hardware remain gated behind their WS-12 acceptance tasks, and the domain units additionally behind **KLDRV-CONF-001**.
- **The café _boundary_ is canonical; the café _code_ is not.** It still lives only in the donor repository — which is precisely why that repository cannot be retired.
- **Nothing was run.** No application was launched; verification is static plus automated tests.

## 4. Verification

**10 PASS / 3 FAIL — identical to baseline. No new failures.** +30 tests.
Full detail in `12_POS_FINAL_VERIFICATION.md`.

## 5. Remaining blockers

| ID                          | Blocker                                          | Blocks                                                            | Owner?      |
| --------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- | ----------- |
| **KLDRV-CONF-001**          | Order/Service/Service Item vs Booking vocabulary | Intake, catalog, order model, and the schema beneath              | **YES**     |
| **KLDRV-CONF-004**          | 21 vs 86 Supabase migration lineage              | Anything touching `supabase/`; `kitluy-suite-supabase` retirement | **YES**     |
| Shift/cash-drawer authority | Unassigned in canonical docs                     | Shift report                                                      | **YES**     |
| Toolchain reconciliation    | Electron 33 vs 40; React 19; Vite 8; TS 6        | Shared UI/routing, café migration                                 | Engineering |
| Data-boundary rewrite       | 84 donor files are cloud-direct                  | All donor data-touching features                                  | Engineering |

## 6. Recommended next step

**Resolve KLDRV-CONF-001.** It gates the largest donor asset (64-file T1 intake)
and everything downstream of the domain vocabulary.

In parallel, **WS-12 T006 hardware/printing/scanning** is the best first code
migration: genuinely portable, no semantics conflict, no data coupling, and
canonical homes already exist.
