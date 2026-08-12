# POS UI and Workflow Matrix

**Filename:** `05_POS_UI_AND_WORKFLOW_MATRIX.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** CURRENT · **Authority:** IMPLEMENTATION-EVIDENCE (static analysis) · **Evidence status:** OBSERVED — **static only**

> **Honesty note.** Screens were inventoried by **static analysis**. None of the
> three applications was launched — see §4. UI _maturity_ below is inferred from
> file counts and structure, not from observed behaviour.

## 1. Laundry donor — screens and workflows

Source: `kitluy-laundry-pos-desk-app@d5d1a26`, `src/features/`.

| Screen / workflow       | Files  | UI maturity  | Data dependency     | Hardware         | Target vertical | Target profile                | Canonical destination                 | Decision                                                   |
| ----------------------- | ------ | ------------ | ------------------- | ---------------- | --------------- | ----------------------------- | ------------------------------------- | ---------------------------------------------------------- |
| T1 POS intake/cashier   | **64** | Substantial  | **Direct Supabase** | printer, scanner | laundry         | `laundry.t1.intake_cashier`   | `apps/…` + `verticals/phase1-laundry` | **REWRITE-DATA-BOUNDARY** (WS-12 T003–T005)                |
| Storage assign / locate | 15     | Moderate     | Direct Supabase     | scanner          | laundry         | t1/t3/t4                      | `verticals/phase1-laundry`            | REWRITE-DATA-BOUNDARY (T003)                               |
| T2 customer display     | 5      | Thin         | Supabase            | display          | laundry         | `laundry.t2.customer_display` | canonical `t2-display-state-machine`  | **SUPERSEDE** — canonical state machine exists             |
| Auth / PIN modal        | 3      | Moderate     | **Direct Supabase** | —                | shared          | —                             | `@kitluy/auth` + T001 sessions        | **SUPERSEDE**                                              |
| Terminal select         | 2      | Thin         | Supabase            | —                | shared          | —                             | —                                     | **SUPERSEDE** — canonical forbids user-selectable identity |
| T3 ready scan-in        | **2**  | **Scaffold** | —                   | scanner          | laundry         | `laundry.t3.ready_scan_in`    | registered, no experience             | **REJECT (insufficient)**                                  |
| T4 pickup scan-out      | **1**  | **Scaffold** | —                   | scanner          | laundry         | `laundry.t4.pickup_scan_out`  | registered, no experience             | **REJECT (insufficient)**                                  |
| Handoff                 | 1      | Scaffold     | Supabase            | —                | laundry         | —                             | —                                     | REWRITE-DATA-BOUNDARY                                      |
| Settings                | 1      | Scaffold     | —                   | —                | shared          | —                             | —                                     | Assess at T007                                             |

Supporting libraries: pricing (`express.ts`), printing (`receiptBuilder`,
`garmentSlipBuilder`, `shiftReportBuilder`, `raster/`, two transports),
`abaPaywayState`, `numbering`, `serviceCatalog`, `exchangeRate.service`.

## 2. Suite donor — screens and workflows

Source: `kitluy-suite-pos-desk-app@3f66249`, `src/`.

| Screen / workflow                          | Signal               | Target vertical | Decision                                    |
| ------------------------------------------ | -------------------- | --------------- | ------------------------------------------- |
| Auth                                       | `features/auth`      | shared          | SUPERSEDE (canonical T001)                  |
| Terminals                                  | `features/terminals` | shared          | **SUPERSEDE** (identity is not selectable)  |
| Shared components / hooks / utils / styles | `shared/`            | shared          | PROMOTE-SHARED — gated on React 19 → 18.3.1 |
| App providers / router                     | `app/`               | shared          | MERGE — gated on toolchain                  |
| **Tabs**                                   | **39 files**         | cafe_restaurant | **REGISTER-INACTIVE**                       |
| **Tables**                                 | **30 files**         | cafe_restaurant | **REGISTER-INACTIVE**                       |
| **Floor plans**                            | **14 files**         | cafe_restaurant | **REGISTER-INACTIVE**                       |
| KDS                                        | 2 files              | cafe_restaurant | **REGISTER-INACTIVE**                       |
| `references/cafe-pos-ui/`                  | build output         | cafe_restaurant | REFERENCE only — not source                 |
| `shared/mock-data`                         | —                    | —               | **REJECT** — not production material        |

Café menu, categories, items, modifiers, cart, dine-in/takeaway/delivery, split,
merge, tips, service charge, course firing: **not evidenced** as discrete
implementations beyond the tab/table/floor material above.

## 3. Canonical shell — coverage before and after

|                                           | Before | After                               |
| ----------------------------------------- | ------ | ----------------------------------- |
| Bootstrap / Hub handshake                 | ✅     | ✅                                  |
| Terminal identity (protected)             | ✅     | ✅                                  |
| Intake state machine (T002)               | ✅     | ✅                                  |
| **Vertical resolution**                   | ❌     | ✅ **BUILT**                        |
| **Vertical module registry**              | ❌     | ✅ **BUILT**                        |
| **T1–T4 experience registration**         | ❌     | ✅ **BUILT** (4 profiles)           |
| **Phase 2 boundary**                      | ❌     | ✅ **BUILT** (registered, inactive) |
| Laundry intake UI                         | ❌     | ❌ — gated (T003)                   |
| Pricing / payment / receipt / printing UI | ❌     | ❌ — gated (T004–T006)              |

## 4. Why the applications were not launched

Owner decision §11 permits running each application _"where safe"_. They were not
launched, and the reasons are recorded rather than worked around:

| Application   | Blocker                                                                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical POS | Electron desktop app requiring a display session; its `t1-startup.e2e.integration` test **self-skips** with _"local Hub database unreachable"_ — no KitLuy Hub Postgres is running |
| Laundry donor | npm install not performed (would add a large tree to a repository staged for retirement); requires Supabase credentials it must not be given                                       |
| Suite donor   | same, plus React 19 / Vite 8 toolchain outside the canonical catalog                                                                                                               |

Additionally the only local Supabase stack (ports 54321–54324) belongs to
**`e-menu-platform`**, a different project — connecting a KitLuy app to it would
be meaningless at best.

Static analysis was therefore the honest method. UI maturity ratings are
structural inferences and are **not** behavioural verification.
