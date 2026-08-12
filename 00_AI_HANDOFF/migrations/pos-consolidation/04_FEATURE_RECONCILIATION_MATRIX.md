# Feature Reconciliation Matrix

**Filename:** `04_FEATURE_RECONCILIATION_MATRIX.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner · **Status:** CURRENT
**Authority:** REFERENCE (classification) + IMPLEMENTATION-EVIDENCE (observed counts)
**Evidence status:** OBSERVED — file counts measured; behaviour not re-verified by execution

## Legend

**Ownership:** `SHARED-CORE` · `SHARED-POS-DESKTOP` · `PHASE1-LAUNDRY` · `FUTURE-PHASE` · `DUPLICATE` · `SUPERSEDED` · `REJECTED` · `UNRESOLVED`

**Action:** `KEEP-MONOREPO` · `MIGRATE-LAUNDRY` · `MIGRATE-SUITE` · `MERGE-BOTH` · `PROMOTE-TO-SHARED` · `KEEP-VERTICAL` · `REFERENCE-FUTURE` · `SUPERSEDE` · `REJECT` · `OWNER-DECISION-REQUIRED`

**WS-12 gate:** the locked task that must run before the unit may be built.

---

## A. Application shell and desktop platform

| ID   | Feature                 | Laundry             | Suite                         | Monorepo                        | Ownership          | Action                  | WS-12 gate | Status                                    |
| ---- | ----------------------- | ------------------- | ----------------------------- | ------------------------------- | ------------------ | ----------------------- | ---------- | ----------------------------------------- |
| F-01 | Electron main process   | `electron/main.ts`  | `electron/main/`              | `electron/main.ts` (Hub-aware)  | SHARED-POS-DESKTOP | **KEEP-MONOREPO**       | —          | Monorepo is Hub-mediated; sources are not |
| F-02 | Preload / IPC boundary  | `preload.cts`       | `electron/preload/`           | `preload.cts` + `intake-ipc.ts` | SHARED-POS-DESKTOP | **KEEP-MONOREPO**       | T003+      | Narrow IPC already delivered in T002      |
| F-03 | React shell / providers | `app/` (6 files)    | `app/providers`, `app/router` | `App.tsx`, `bootstrap-view.tsx` | SHARED-POS-DESKTOP | MERGE-BOTH              | T007       | Version reconciliation needed first       |
| F-04 | Routing                 | `ScreenRouter.tsx`  | `app/router/`                 | (bootstrap only)                | SHARED-POS-DESKTOP | OWNER-DECISION-REQUIRED | T007       | Depends on KLDRV-CONF-003                 |
| F-05 | Theming / design tokens | `ThemeProvider.tsx` | suite commit `2c83025`        | `@kitluy/pos-ui`                | SHARED-POS-DESKTOP | PROMOTE-TO-SHARED       | T007       | Low-risk candidate, still gated           |
| F-06 | On-screen keyboard      | `electron/osk.ts`   | —                             | —                               | SHARED-POS-DESKTOP | MIGRATE-LAUNDRY         | T006       | Peripheral scope                          |

## B. Identity, session, authorization

| ID   | Feature            | Laundry                                             | Suite                | Monorepo                                          | Ownership          | Action                  | WS-12 gate | Status                                                                       |
| ---- | ------------------ | --------------------------------------------------- | -------------------- | ------------------------------------------------- | ------------------ | ----------------------- | ---------- | ---------------------------------------------------------------------------- |
| F-10 | Authentication     | `features/auth`, `services/auth.service`            | `features/auth`      | `@kitluy/auth` + T001 staff sessions              | SHARED-CORE        | **KEEP-MONOREPO**       | —          | T001 delivered sessions under 5 canonical permission keys                    |
| F-11 | PIN entry          | `features/auth/PinModal.tsx` **(imports Supabase)** | —                    | —                                                 | SHARED-POS-DESKTOP | REJECT (as written)     | T001 done  | Direct Supabase — violates hard rule 6. Re-implement over Hub                |
| F-12 | Terminal selection | `features/terminal-select`                          | `features/terminals` | `terminal-identity.ts` (protected, override-free) | SHARED-POS-DESKTOP | **SUPERSEDE**           | —          | Monorepo forbids user override of terminal identity; sources allow selection |
| F-13 | Terminal session   | `services/terminal-session.service` **(Supabase)**  | —                    | T001 device session                               | SHARED-CORE        | **SUPERSEDE**           | —          | Monorepo authority is Hub-attested                                           |
| F-14 | RBAC / permissions | implicit                                            | implicit             | `@kitluy/rbac` + registry amendments 001–003      | SHARED-CORE        | **KEEP-MONOREPO**       | —          | Canonical registry is authoritative                                          |
| F-15 | Shift management   | `services/shifts.service`                           | —                    | —                                                 | PHASE1-LAUNDRY?    | OWNER-DECISION-REQUIRED | T005+      | Shift/cash-drawer authority unassigned in canonical docs                     |

## C. Store, location, device

| ID   | Feature                           | Laundry                 | Suite | Monorepo                                                          | Ownership          | Action            | WS-12 gate | Status                                         |
| ---- | --------------------------------- | ----------------------- | ----- | ----------------------------------------------------------------- | ------------------ | ----------------- | ---------- | ---------------------------------------------- |
| F-20 | Tenant / Digital Store / Location | `provisioningState.ts`  | —     | `@kitluy/tenant-context`, `digital-store-context`; T001 bootstrap | SHARED-CORE        | **KEEP-MONOREPO** | —          | Installer/user may never override — sources do |
| F-21 | Device identity                   | —                       | —     | `@kitluy/device-identity`, `terminal-identity.ts`                 | SHARED-CORE        | **KEEP-MONOREPO** | —          | BLK-005 PKI decision applies                   |
| F-22 | Hub discovery                     | 13 files touch LAN/edge | —     | `mdns.ts` (locked 6-source endpoint order)                        | SHARED-POS-DESKTOP | **KEEP-MONOREPO** | —          | Monorepo order is order-exact test-pinned      |
| F-23 | Provisioning                      | `provisioningState`     | —     | `services/kitluy-provisioning-service`                            | SHARED-CORE        | **KEEP-MONOREPO** | —          | Cloud-management path                          |

## D. Catalog, pricing, customers

| ID   | Feature            | Laundry                                                                         | Suite                | Monorepo                               | Ownership                  | Action                      | WS-12 gate | Status                                                          |
| ---- | ------------------ | ------------------------------------------------------------------------------- | -------------------- | -------------------------------------- | -------------------------- | --------------------------- | ---------- | --------------------------------------------------------------- |
| F-30 | Catalog / services | `services/catalog.service`, `data/catalog` **(Supabase)**, `lib/serviceCatalog` | generic presentation | `@kitluy/catalog`                      | SHARED-CORE + PHASE1 delta | **OWNER-DECISION-REQUIRED** | **T003**   | **KLDRV-CONF-001** — Service/Service Item vs Booking vocabulary |
| F-31 | Customer identity  | `services/customers.service`, `data/customers`                                  | —                    | `@kitluy/customers`; **T002 COMPLETE** | SHARED-CORE                | **KEEP-MONOREPO**           | —          | T002 delivered customer/consent/draft authority end-to-end      |
| F-32 | Consent            | not present                                                                     | —                    | T002 (never a preselected boolean)     | SHARED-CORE                | **KEEP-MONOREPO**           | —          | Canonical is stricter than source                               |
| F-33 | Pricing — general  | `lib/pricing/`, per-piece/weight                                                | —                    | `@kitluy/pricing`                      | SHARED-CORE                | MERGE-BOTH                  | **T004**   | Gated                                                           |
| F-34 | Express pricing    | `lib/pricing/express.ts` + test                                                 | —                    | —                                      | PHASE1-LAUNDRY             | KEEP-VERTICAL               | **T004**   | Genuine Phase 1 asset                                           |
| F-35 | FX KHR/USD         | `exchangeRate.service`, `paywayUsdFromKhr`                                      | —                    | `@kitluy/money`                        | SHARED-CORE                | MERGE-BOTH                  | T004       | **No floating-point money** — must use `@kitluy/money`          |
| F-36 | Discounts / tax    | partial                                                                         | —                    | —                                      | SHARED-CORE                | UNRESOLVED                  | T004       | Not evidenced in either source                                  |

## E. Laundry Booking / intake — the conflict centre

| ID   | Feature                 | Laundry                                     | Suite                  | Monorepo                                     | Ownership      | Action                      | WS-12 gate | Status                                                       |
| ---- | ----------------------- | ------------------------------------------- | ---------------------- | -------------------------------------------- | -------------- | --------------------------- | ---------- | ------------------------------------------------------------ |
| F-40 | Intake / order creation | `features/t1-pos` (**64 files**)            | ported UI in `3f66249` | `t002-intake-machine`, 15-state machine      | PHASE1-LAUNDRY | **OWNER-DECISION-REQUIRED** | **T003**   | **KLDRV-CONF-001 blocks this directly**                      |
| F-41 | Order model             | `data/orders`, `order-hierarchy-repository` | —                      | `verticals/phase1-laundry/booking-lifecycle` | PHASE1-LAUNDRY | **OWNER-DECISION-REQUIRED** | T003       | Order→Service→Service Item **vs** Booking                    |
| F-42 | Garments                | `data/laundry`                              | —                      | (T003 not started)                           | PHASE1-LAUNDRY | KEEP-VERTICAL               | **T003**   | Gated                                                        |
| F-43 | Numbering               | `lib/numbering.ts` + test                   | —                      | —                                            | SHARED-CORE    | MIGRATE-LAUNDRY             | T003       | Candidate; verify no vertical terminology                    |
| F-44 | Order queue             | 31 files                                    | —                      | durable outbox (T002)                        | SHARED-CORE    | **SUPERSEDE**               | —          | Source has **0 outbox** files; canonical uses durable outbox |

## F. Payments, receipts, printing

| ID   | Feature                | Laundry                                                             | Suite   | Monorepo                               | Ownership                       | Action                  | WS-12 gate | Status                                |
| ---- | ---------------------- | ------------------------------------------------------------------- | ------- | -------------------------------------- | ------------------------------- | ----------------------- | ---------- | ------------------------------------- |
| F-50 | KHQR                   | 10 files                                                            | 8 files | `@kitluy/payments`                     | SHARED-CORE                     | MERGE-BOTH              | **T005**   | Gated — payment authority             |
| F-51 | ABA PayWay             | 25 files, `abaPaywayState`                                          | —       | provider adapters                      | SHARED-CORE                     | MIGRATE-LAUNDRY         | **T005**   | Provider clients stay behind adapters |
| F-52 | Deposits               | `t1-pos`                                                            | —       | —                                      | PHASE1-LAUNDRY                  | OWNER-DECISION-REQUIRED | **T005**   | Finance semantics                     |
| F-53 | Receipts               | `lib/printing/receiptBuilder`                                       | —       | `@kitluy/printing`                     | SHARED-CORE + vertical template | MIGRATE-LAUNDRY         | **T005**   | Gated                                 |
| F-54 | Garment tags           | `garmentSlipBuilder`                                                | —       | —                                      | PHASE1-LAUNDRY                  | KEEP-VERTICAL           | **T005**   | Gated                                 |
| F-55 | Shift report           | `shiftReportBuilder`                                                | —       | —                                      | UNRESOLVED                      | OWNER-DECISION-REQUIRED | T005       | Depends on F-15                       |
| F-56 | Thermal / USB printing | `thermal-printer.ts`, `hardware/usb-printer`, `raster/`, transports | 1 file  | `@kitluy/printing`, `@kitluy/hardware` | SHARED-CORE                     | MIGRATE-LAUNDRY         | **T006**   | Strong asset; gated                   |

## G. Custody, production, T2–T4

| ID   | Feature              | Laundry                                                   | Suite | Monorepo                          | Ownership      | Action                    | WS-12 gate | Status                         |
| ---- | -------------------- | --------------------------------------------------------- | ----- | --------------------------------- | -------------- | ------------------------- | ---------- | ------------------------------ |
| F-60 | Custody events       | `data/laundry`, `features/storage` (15)                   | —     | `custody-events.ts`               | PHASE1-LAUNDRY | **KEEP-MONOREPO**         | —          | Canonical module exists        |
| F-61 | Production lifecycle | partial                                                   | —     | `production-state-machine` + test | PHASE1-LAUNDRY | **KEEP-MONOREPO**         | —          | Canonical is more complete     |
| F-62 | T2 customer display  | `features/t2-display` (5)                                 | —     | `t2-display-state-machine`        | PHASE1-LAUNDRY | **KEEP-MONOREPO**         | —          | Canonical state machine exists |
| F-63 | T3 scan-in           | `features/t3-scanin` (**2**)                              | —     | —                                 | PHASE1-LAUNDRY | **REJECT** (insufficient) | post-T007  | Source is scaffold-level       |
| F-64 | T4 pickup scan-out   | `features/t4-dispatch` (**1**)                            | —     | —                                 | PHASE1-LAUNDRY | **REJECT** (insufficient) | post-T007  | Source is scaffold-level       |
| F-65 | Storage assignment   | `features/storage` (15), `order-pickup-locate-repository` | —     | —                                 | PHASE1-LAUNDRY | MIGRATE-LAUNDRY           | T003       | Genuine asset; gated           |
| F-66 | Rewash / damage      | not evidenced                                             | —     | —                                 | PHASE1-LAUNDRY | UNRESOLVED                | —          | Neither source implements      |

## H. Offline, sync, hardware

| ID   | Feature                    | Laundry                                   | Suite | Monorepo                                                         | Ownership          | Action            | WS-12 gate | Status                                         |
| ---- | -------------------------- | ----------------------------------------- | ----- | ---------------------------------------------------------------- | ------------------ | ----------------- | ---------- | ---------------------------------------------- |
| F-70 | Offline operation          | 12 files                                  | —     | `@kitluy/sync-protocol`, `terminal-local-store`, `tests/offline` | SHARED-CORE        | **KEEP-MONOREPO** | **T006**   | Source is cloud-direct; canonical is Hub-first |
| F-71 | Store Hub comms            | 13 files                                  | —     | `lan-client.ts`, mTLS `/edge/v1`                                 | SHARED-POS-DESKTOP | **KEEP-MONOREPO** | —          | Canonical is authoritative                     |
| F-72 | Barcode / scanner          | 30 / 13 files, `hardware/scanner-service` | —     | `@kitluy/hardware`                                               | SHARED-CORE        | MIGRATE-LAUNDRY   | **T006**   | Strong asset; gated                            |
| F-73 | Serial peripherals         | 4 files                                   | —     | `@kitluy/hardware`                                               | SHARED-CORE        | MIGRATE-LAUNDRY   | T006       | Gated                                          |
| F-74 | Localization Khmer/English | 8 files                                   | —     | `@kitluy/localization`; T002 bilingual strings                   | SHARED-CORE        | MERGE-BOTH        | **T007**   | Gated                                          |

## I. Café / restaurant — Phase 2

| ID   | Feature                   | Suite        | Ownership    | Action               |
| ---- | ------------------------- | ------------ | ------------ | -------------------- |
| F-80 | Tabs                      | **39 files** | FUTURE-PHASE | **REFERENCE-FUTURE** |
| F-81 | Tables                    | **30 files** | FUTURE-PHASE | **REFERENCE-FUTURE** |
| F-82 | Floor plans               | **14 files** | FUTURE-PHASE | **REFERENCE-FUTURE** |
| F-83 | KDS                       | 2 files      | FUTURE-PHASE | **REFERENCE-FUTURE** |
| F-84 | `references/cafe-pos-ui/` | build output | FUTURE-PHASE | **REFERENCE-FUTURE** |

**Phase 2 must not be activated.** These remain in the preserved repository and
its verified bundle; none is migrated.

## J. Data layer — blanket finding

| ID   | Feature                | Finding                                              | Action                                                                      |
| ---- | ---------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| F-90 | Direct Supabase access | **84 of 285 laundry `src/` files**                   | **REJECT as written** — re-implement over Hub / governed APIs (mission §16) |
| F-91 | Supabase migrations    | 21 in `kitluy-suite-supabase` vs 86 `.sql` canonical | **OWNER-DECISION-REQUIRED** — KLDRV-CONF-004                                |
| F-92 | Mock data              | `suite/shared/mock-data`                             | REJECT — not production material                                            |

## Summary

| Action                                              | Count |
| --------------------------------------------------- | ----- |
| `KEEP-MONOREPO` (canonical already equal or better) | 14    |
| `OWNER-DECISION-REQUIRED`                           | 8     |
| `MIGRATE-LAUNDRY` (gated by WS-12)                  | 8     |
| `REFERENCE-FUTURE` (Phase 2)                        | 5     |
| `MERGE-BOTH` (gated)                                | 5     |
| `SUPERSEDE`                                         | 4     |
| `REJECT`                                            | 5     |
| `KEEP-VERTICAL` (gated)                             | 3     |
| `PROMOTE-TO-SHARED` (gated)                         | 1     |
| `UNRESOLVED`                                        | 3     |

**Units migratable today: 0.** Every `MIGRATE-*`, `MERGE-BOTH`,
`PROMOTE-TO-SHARED` and `KEEP-VERTICAL` unit is gated behind a WS-12 task that
is **NOT STARTED**, or behind an owner decision. See `09_UNRESOLVED_CONFLICTS.md`.
