# Laundry POS Inventory — `kitluy-laundry-pos-desk-app`

**Filename:** `02_LAUNDRY_POS_INVENTORY.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** EVIDENCE (carried into pos-unification under the 2026-08-07 owner decision) · **Authority:** IMPLEMENTATION-EVIDENCE · **Evidence status:** OBSERVED

HEAD `d5d1a26…`, branch `feat/full-app-wiring`, 94 commits, clean. **285 `src/` files.**

## 1. Structure

```text
src/
├── app/          App.tsx, AppContext, KitluyNativeProvider, QueryProvider,
│                 ScreenRouter, ThemeProvider, provisioningState
├── features/     auth · handoff · settings · storage · terminal-select
│                 t1-pos · t2-display · t3-scanin · t4-dispatch
├── services/     auth · catalog · customers · exchangeRate · native-checkout
│                 orders · shifts · slots · terminal-session · terminals
├── data/         auth catalog customers handoff integration laundry orders
│                 storage terminal · kitluy-client.ts
├── lib/          pricing/ printing/ abaPayway* numbering serviceCatalog
│                 posApi supabase kitluy-supabase formatters phone
├── hooks/ components/ types/ fixtures/ styles/ assets/
electron/         main.ts · preload.cts · osk.ts · thermal-printer.ts
                  hardware/{scanner-service.ts, usb-printer.ts}
```

## 2. Terminal coverage — T1 is the substance

| Feature               | Files  | Assessment                                |
| --------------------- | ------ | ----------------------------------------- |
| `t1-pos`              | **64** | Substantial intake/cashier implementation |
| `storage`             | 15     | Storage assignment/locate                 |
| `t2-display`          | 5      | Thin customer display                     |
| `auth`                | 3      | PIN modal + session                       |
| `t3-scanin`           | **2**  | Scaffold-level only                       |
| `terminal-select`     | 2      | Terminal chooser                          |
| `t4-dispatch`         | **1**  | Scaffold-level only                       |
| `handoff`, `settings` | 1 each | Minimal                                   |

**T3 and T4 are effectively unimplemented here** — 3 files combined. The canonical
T1–T4 model is not fully realised in this source.

## 3. Capability probes (files matching)

| Capability | Files | Notes                                                     |
| ---------- | ----- | --------------------------------------------------------- |
| KHR        | 32    | Dual-currency present                                     |
| queue      | 31    | Order queue (not an outbox)                               |
| barcode    | 30    | Scanning present                                          |
| USD        | 27    | Dual-currency present                                     |
| printer    | 26    | Receipt/garment/shift builders                            |
| ABA        | 25    | ABA PayWay payment integration                            |
| scanner    | 13    | Scanner service                                           |
| KHQR       | 10    | KHQR present                                              |
| thermal    | 10    | Thermal printing                                          |
| Khmer      | 8     | Localization present                                      |
| serialport | 4     | Serial hardware                                           |
| **outbox** | **0** | **No outbox pattern — canonical requires durable outbox** |
| bluetooth  | 0     | Not present                                               |

## 4. Notable implementation assets

- `lib/printing/` — `receiptBuilder`, `garmentSlipBuilder`, `shiftReportBuilder`, `raster/`, `electronTransport`, `webusbTransport`
- `lib/pricing/express.ts` (+ test) — express-service pricing
- `lib/abaPaywayState.ts`, `abaPaywayDisplay.ts`, `paywayUsdFromKhr.ts` — payment state and FX
- `lib/numbering.ts` (+ test), `serviceCatalog.ts`, `serviceCode.ts`
- `electron/hardware/` — `scanner-service`, `usb-printer`
- `services/exchangeRate.service.ts` — KHR/USD conversion
- 27 test files

## 5. Architecture assessment — the blocking finding

| Signal                                         | Count                |
| ---------------------------------------------- | -------------------- |
| `src/` files referencing Supabase              | **84 of 285 (~29%)** |
| Files referencing Store Hub / LAN / `/edge/v1` | **13**               |
| Outbox pattern                                 | **0**                |

This application is **cloud-direct**: terminals talk to Supabase. The canonical
architecture requires `Digital Store → Store Hub → T1–T4`, with terminals never
writing to Supabase (`CLAUDE.md` hard rule 6; `PROJECT_HOME.md` §3.5).

**Consequence:** this is not a port. Every data-touching feature needs
**re-implementation against Hub/governed-API contracts**, not migration. The UI
and domain logic are valuable evidence; the data layer is not reusable as-is.
