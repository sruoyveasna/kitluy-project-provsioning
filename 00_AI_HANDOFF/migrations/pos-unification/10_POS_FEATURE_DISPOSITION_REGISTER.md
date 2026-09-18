# POS Feature Disposition Register — no-feature-loss gate

**Filename:** `10_POS_FEATURE_DISPOSITION_REGISTER.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** CURRENT · **Authority:** IMPLEMENTATION-EVIDENCE (counts observed) + REFERENCE (dispositions)

> **Gate rule (owner decision §26):** every meaningful capability from both donor
> repositories must have exactly one disposition. **Nothing may simply disappear.**

Dispositions: `MIGRATED` · `SUPERSEDED-BY-BETTER-CANONICAL` ·
`REGISTERED-INACTIVE-FUTURE-PHASE` · `REJECTED-WITH-REASON` ·
`OWNER-DECISION-REQUIRED` · `GATED-PENDING-WS12-TASK`

## A. Laundry donor — `kitluy-laundry-pos-desk-app@d5d1a26`

| Capability                            | Evidence                                      | Disposition                        | Destination / reason                                                                                             |
| ------------------------------------- | --------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| T1 POS intake/cashier                 | 64 files                                      | **GATED-PENDING-WS12-TASK**        | T003–T005; also KLDRV-CONF-001                                                                                   |
| Storage assign / locate               | 15 files                                      | GATED-PENDING-WS12-TASK            | T003 → `verticals/phase1-laundry`                                                                                |
| T2 customer display                   | 5 files                                       | **SUPERSEDED-BY-BETTER-CANONICAL** | `t2-display-state-machine`                                                                                       |
| Auth / PIN modal                      | 3 files                                       | **SUPERSEDED-BY-BETTER-CANONICAL** | `@kitluy/auth` + T001 staff sessions                                                                             |
| Terminal selection                    | 2 files                                       | **REJECTED-WITH-REASON**           | Canonical forbids user-selectable terminal identity; migrating would regress a locked security property          |
| T3 ready scan-in                      | **2 files**                                   | **REJECTED-WITH-REASON**           | Scaffold-level; no usable implementation. Profile registered, experience not declared                            |
| T4 pickup scan-out                    | **1 file**                                    | **REJECTED-WITH-REASON**           | Scaffold-level; same                                                                                             |
| Handoff                               | 1 file                                        | GATED-PENDING-WS12-TASK            | T003                                                                                                             |
| Settings                              | 1 file                                        | GATED-PENDING-WS12-TASK            | T007                                                                                                             |
| Order queue (31 files)                | no outbox                                     | **SUPERSEDED-BY-BETTER-CANONICAL** | Durable outbox delivered in T002                                                                                 |
| Express pricing (`express.ts` + test) | 2 files                                       | GATED-PENDING-WS12-TASK            | T004 → `verticals/phase1-laundry`                                                                                |
| FX KHR/USD                            | `exchangeRate.service`, `paywayUsdFromKhr`    | GATED-PENDING-WS12-TASK            | T004; must convert to `@kitluy/money`                                                                            |
| ABA PayWay                            | 25 files                                      | GATED-PENDING-WS12-TASK            | T005 → provider adapter                                                                                          |
| KHQR                                  | 10 files                                      | GATED-PENDING-WS12-TASK            | T005 → `@kitluy/payments`                                                                                        |
| Receipt builder                       | `receiptBuilder`                              | GATED-PENDING-WS12-TASK            | T005 → `@kitluy/printing`                                                                                        |
| Garment slip builder                  | `garmentSlipBuilder`                          | GATED-PENDING-WS12-TASK            | T005 → `verticals/phase1-laundry`                                                                                |
| Shift report builder                  | `shiftReportBuilder`                          | **OWNER-DECISION-REQUIRED**        | Shift/cash-drawer authority unassigned in canonical docs                                                         |
| Thermal printing                      | `thermal-printer.ts`, `raster/`, 2 transports | GATED-PENDING-WS12-TASK            | T006 → `@kitluy/printing`                                                                                        |
| USB printer                           | `hardware/usb-printer.ts`                     | GATED-PENDING-WS12-TASK            | T006 → `@kitluy/hardware`                                                                                        |
| Barcode / scanner                     | 30 / 13 files, `scanner-service`              | GATED-PENDING-WS12-TASK            | T006 → `@kitluy/hardware`                                                                                        |
| Serial peripherals                    | 4 files                                       | GATED-PENDING-WS12-TASK            | T006                                                                                                             |
| On-screen keyboard                    | `electron/osk.ts`                             | GATED-PENDING-WS12-TASK            | T006                                                                                                             |
| Numbering                             | `numbering.ts` + test                         | GATED-PENDING-WS12-TASK            | T003; verify neutrality                                                                                          |
| Service catalog                       | `serviceCatalog.ts`, `serviceCode.ts`         | **OWNER-DECISION-REQUIRED**        | KLDRV-CONF-001 vocabulary                                                                                        |
| Localization Khmer/English            | 8 files                                       | GATED-PENDING-WS12-TASK            | T007 → `@kitluy/localization`                                                                                    |
| Offline handling                      | 12 files                                      | **SUPERSEDED-BY-BETTER-CANONICAL** | Canonical is Hub-first; donor is cloud-direct                                                                    |
| Store Hub / LAN references            | 13 files                                      | **SUPERSEDED-BY-BETTER-CANONICAL** | `lan-client.ts` + mTLS `/edge/v1`                                                                                |
| **Direct Supabase data layer**        | **84 of 285 files**                           | **REJECTED-WITH-REASON**           | Violates hard rule 6 and owner decision §20; behaviour re-implemented over Hub contracts, coupling not preserved |
| Electron main / preload               | `main.ts`, `preload.cts`                      | **SUPERSEDED-BY-BETTER-CANONICAL** | Canonical is Hub-aware                                                                                           |
| Pi build configs                      | `electron-builder.rpi5.json`                  | GATED-PENDING-WS12-TASK            | Relevant to `infra/kitluy-os-image`                                                                              |
| Release / deployment logs             | `Release/`, `deployment-logs/`                | **REJECTED-WITH-REASON**           | Evidence artifacts, not source                                                                                   |
| 27 test files                         | —                                             | GATED-PENDING-WS12-TASK            | Per `11_POS_TEST_RECONCILIATION.md`                                                                              |

## B. Suite donor — `kitluy-suite-pos-desk-app@3f66249`

| Capability                                 | Evidence                     | Disposition                          | Destination / reason                                           |
| ------------------------------------------ | ---------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Auth                                       | `features/auth`              | **SUPERSEDED-BY-BETTER-CANONICAL**   | T001 staff sessions                                            |
| Terminals                                  | `features/terminals`         | **REJECTED-WITH-REASON**             | Selectable identity forbidden                                  |
| Shared components / hooks / utils / styles | `shared/`                    | GATED-PENDING-WS12-TASK              | T007 → `@kitluy/pos-ui` / `web-ui`; React 19 → 18.3.1 first    |
| App providers / router                     | `app/`                       | GATED-PENDING-WS12-TASK              | T007                                                           |
| Design tokens / touch input pad            | commit `2c83025`             | GATED-PENDING-WS12-TASK              | T007                                                           |
| Ported laundry UI                          | commits `3f66249`, `5c308be` | GATED-PENDING-WS12-TASK              | T003–T007; overlaps the laundry donor                          |
| **Tabs**                                   | **39 files**                 | **REGISTERED-INACTIVE-FUTURE-PHASE** | Phase 2 boundary registered in `modules.ts`; code not migrated |
| **Tables**                                 | **30 files**                 | **REGISTERED-INACTIVE-FUTURE-PHASE** | as above                                                       |
| **Floor plans**                            | **14 files**                 | **REGISTERED-INACTIVE-FUTURE-PHASE** | as above                                                       |
| KDS                                        | 2 files                      | **REGISTERED-INACTIVE-FUTURE-PHASE** | as above                                                       |
| KHQR presentation                          | 8 files                      | GATED-PENDING-WS12-TASK              | T005                                                           |
| Electron main / preload / services         | `electron/`                  | **SUPERSEDED-BY-BETTER-CANONICAL**   | Canonical is Hub-aware                                         |
| `references/cafe-pos-ui/`                  | build output                 | **REJECTED-WITH-REASON**             | Compiled reference material, not source                        |
| `shared/mock-data`                         | —                            | **REJECTED-WITH-REASON**             | Not production material                                        |

## C. Built this cycle

| Capability                          | Disposition                          | Destination                       |
| ----------------------------------- | ------------------------------------ | --------------------------------- |
| Vertical resolver                   | **MIGRATED** (new canonical)         | `@kitluy/digital-store-context`   |
| Vertical module contract            | **MIGRATED** (new canonical)         | `apps/…/src/vertical/contract.ts` |
| Vertical registry / host            | **MIGRATED** (new canonical)         | `apps/…/src/vertical/registry.ts` |
| Laundry module registration (T1–T4) | **MIGRATED**                         | `apps/…/src/vertical/modules.ts`  |
| Café module registration            | **REGISTERED-INACTIVE-FUTURE-PHASE** | `apps/…/src/vertical/modules.ts`  |

## D. Gate result

| Check                                        | Result                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Every donor capability has a disposition     | **PASS** — 45 rows, none unassigned                                                      |
| Nothing silently discarded                   | **PASS**                                                                                 |
| Phase 2 preserved as inactive, not activated | **PASS** — boundary registered; two independent gates                                    |
| Direct-Supabase coupling not carried forward | **PASS** — rejected with reason; behaviour re-implementation deferred to its WS-12 tasks |

> **Important:** `REGISTERED-INACTIVE-FUTURE-PHASE` for the café capabilities
> means the **boundary** exists canonically — the **code** still lives only in
> the donor repository. That is why `kitluy-suite-pos-desk-app` cannot yet be
> retired.

---

## E. Update — 2026-08-07, KLDRV-CONF-001 resolved

`KLD-2026-08-07-BOOKING-SEMANTICS-001` settles the domain semantics: catalog
**Service** → vertical operational aggregate (**Laundry Booking**) → shared
vertical-neutral **Transaction**.

Entries previously `OWNER-DECISION-REQUIRED` on vocabulary grounds move to
`GATED-PENDING-WS12-TASK` — the semantics are settled, the **sequencing** is not:

| Capability                                              | Was                     | Now                                           | Mapping under the decision                                            |
| ------------------------------------------------------- | ----------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| Service catalog (`serviceCatalog.ts`, `serviceCode.ts`) | OWNER-DECISION-REQUIRED | **GATED-PENDING-WS12-TASK**                   | Catalog **Service** layer (§2.1)                                      |
| T1 intake (64 files)                                    | GATED (+ CONF-001)      | **GATED-PENDING-WS12-TASK**                   | **Laundry Booking** aggregate (§2.2) — T003                           |
| `data/orders`, `order-hierarchy-repository`             | GATED (+ CONF-001)      | **OWNER-REVIEW-REQUIRED (§4 classification)** | Each legacy `Order` use classified before any port; no blanket rename |
| Booking lines / cart lines                              | —                       | **GATED-PENDING-WS12-TASK**                   | Booking lines **snapshot** the Service and effective pricing (§2.2)   |

Still `OWNER-DECISION-REQUIRED`: shift/cash-drawer authority (F-15, F-55).

### New donor gap recorded

T003 is _Service, Garment, **Evidence** and **Custody** Intake_. Donor coverage:

| Subject      | Donor files | Disposition                                                            |
| ------------ | ----------- | ---------------------------------------------------------------------- |
| Service      | 101 / 64    | GATED-PENDING-WS12-TASK (T003)                                         |
| Garment      | 38 / 24     | GATED-PENDING-WS12-TASK (T003)                                         |
| **Evidence** | **0**       | **NO DONOR — build against canonical contracts**                       |
| **Custody**  | **0**       | **NO DONOR — canonical `custody-events.ts` is the starting authority** |

Half of T003's named subject matter has no donor implementation to migrate.

## F. Update — 2026-09-18, T1-FACE-PORT-001 (owner: "T1 booking face first")

| Capability                            | Was                     | Now                                                                                                                                                                                                                                 |
| ------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 POS intake/cashier — presentation  | GATED-PENDING-WS12-TASK | **MIGRATED (presentation only)** → `apps/kitluy-pos-desktop-app/src/vertical/laundry/face/` (shell, top bar, booking workspace, Items/Customer steps, keyboard/numpads, icons, theme, Khmer font); each screen names its donor file |
| T1 POS intake/cashier — data layer    | REJECTED (Supabase)     | unchanged: re-implemented over the Store Hub ports (customer search/create, Booking Draft, PIN lock); catalog port answers `not_delivered` until WS-05 delivery                                                                     |
| Pricing / payment / receipt / shifts  | GATED (T004–T006)       | unchanged; rendered as "not available yet" with the gating task named                                                                                                                                                               |
| Terminal selection                    | REJECTED-WITH-REASON    | unchanged: the launcher shows the assignment (`src/terminal-launcher.tsx`), one live card, no choice                                                                                                                                |
| Auth / PIN modal                      | SUPERSEDED              | the Terminal PIN pad in the donor's modal chrome (KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001)                                                                                                                                |
| Service catalog (`serviceCatalog.ts`) | GATED (T003)            | lane chrome ported (`lib/serviceCatalog.tsx`) keyed to pricing modes; services and prices come only from the delivered catalog                                                                                                      |
| Localization Khmer/English            | GATED (T007)            | the donor had no string table — bilingual literals came over as-is; the launcher carries km/en text; a string table stays T007                                                                                                      |

Record: `00_AI_HANDOFF/edge-platform/50_LAUNDRY_T1_FACE_ON_PI.md`; decision KLD-2026-09-18-T1-FACE-PORT-001.
