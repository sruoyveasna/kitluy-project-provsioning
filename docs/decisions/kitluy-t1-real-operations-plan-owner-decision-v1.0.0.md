# KitLuy T1 Real Operations Plan — Owner Decision v1.0.0

**Filename:** `kitluy-t1-real-operations-plan-owner-decision-v1.0.0.md`
**Decision ID:** KLD-2026-09-19-T1-REAL-OPERATIONS-001
**Date:** 2026-09-19
**Owner:** HET / KitLuy Suite Project Owner
**Status:** OWNER-APPROVED ("go", 2026-09-19) — the plan below is recorded as
presented and approved; slice status is maintained in the handoffs it names.
**Owner answers recorded with the approval:** price list = the designed app's
catalog (`kitluy-laundry-pos-desk-app@8b2f107`); per-weight rule = whole kg,
rounded UP, minimum 1 kg; payment at intake = cash in full, KHR + USD; a USB
thermal (ESC/POS) printer is attached to the Pi T1.
**Does NOT resolve:** BLK-005 (signer custody), BLK-006 (production producers
and providers — KHQR stays gated), pilot/production claims.

---

## 1. Context — what the analysis found

**Three tiers, and where the truth already lives**

| Capability | Store Hub (local PostgreSQL) | Hub agent | LAN route served | Pi terminal | Cloud (`kitluy-fresh`) |
| --- | --- | --- | --- | --- | --- |
| Customer, consent, Booking Draft | 0040/0041 | `t1-intake.ts` | yes | face | 0186/0187 doors + consumer |
| Service catalog + prices | `configuration_section` is generic; only `terminal_profiles` published | one-section publisher | `/configuration/current` delivers all sections | stores `payloadJson`, **never parses it**; `readCatalog` hard-coded `not_delivered` | `kitluy_core.catalog_items`, `kitluy_laundry.services`, `service_prices` (WS-05) exist, seeded with demo rows; **no publisher, no Partner routes** |
| Booking, lines, garments, bags, tags, status/custody events, storage, T3/T4 sessions | `edge_laundry.*` (0005) — complete | `commands/*` + `command-pipeline.ts` — **tested library, not routed** | no | cart in memory only | `kitluy_orders`, `kitluy_laundry` (0075/0080) exist; **no ingestion door** |
| Pricing engine | `pricing` section (seed only) | `verticals/phase1-laundry/src/pricing.ts` (`pricePerPieceLine`, `pricePerWeightLine(rule)`), `@kitluy/money` | — | Step 2 is a stub | `service_prices` |
| Cash payment, receipt, print job | `edge_payments.*` (0006), `edge_documents.*` (0007) | `payment-commands.ts`, `print-commands.ts` — library | no | none | 0085 tables, no door |

**The donor app** (`kitluy-laundry-pos-desk-app@8b2f107`) is the design and the *behavioural* reference: 4-step T1 wizard, whole-kg Wash & Fold + per-piece Dry Clean / Wash & Press with stain flag, express toggle, cash KHR+USD keypad, bilingual raster receipts on a USB ESC/POS printer, T3/T4 storage board. Its shipped build runs on fixtures (`AUTH_BYPASS = true`); its native data layer targets the standalone Supabase RPCs. Everything that touched Supabase directly stays REJECTED (hard rule 6).

**The standalone Supabase** (`kitluy-suite-supabase@68a2b78`) is the *rulebook*: integer KHR, `order_rules_versions` (deposit bps, minimum order, express bps, turnaround), 14-status fulfilment machine, one active storage assignment per booking, 5-in-15 PIN lock, USD tender with recorded rate. It is a different lineage from the monorepo's canonical WS-05/07/08 tables (KLDRV-CONF-004). **Its migrations are not copied** (repository rule: no code/migration merging from standalone repos); its rules and its price vocabulary are re-expressed in monorepo migrations.

**Owner answers (2026-09-19)**: price list = the designed app's catalog; per-weight rule = whole kg rounded UP, minimum 1 kg; payment = cash in full at intake, KHR + USD; printer = USB thermal ESC/POS attached to the Pi.

## 2. Decisions this plan asks the owner to approve (recorded as KLD-2026-09-19-T1-REAL-OPERATIONS-001 on approval)

1. **T1 creates the Booking at confirm, from the verified cart, in one Hub command.** The approved route `POST /edge/v1/laundry/bookings/{id}/confirm-intake` (edge-contracts, permission `laundry.bookings.create`, T1 only, idempotent) is served with `{id}` = the WS-12-T002 Booking Draft; the body carries the lines, the tender and the terminal's *displayed* totals. The Hub prices every line itself (vertical engine + the Store's configured rule), refuses `PRICE_MISMATCH` if the terminal's figures differ, converts the draft (`lifecycle = converted`), writes `edge_laundry.booking` + `booking_line` + `status_event`, the cash `edge_payments.payment` (+ USD `tender_leg` at the configured rate), the `edge_documents.receipt` and a `print_job`, and answers the receipt payload. A companion read `POST …/drafts/{draftId}/quote` (no write) returns the Hub-priced lines so Step 2 shows Hub truth before confirm. This is the rebuild bible §5.8 model and the standalone's `create_full_order` model; no per-line routes (Group 1 rejected inferred draft-update routes — this decision approves exactly these two).
2. **KLREC-2026-09-19-ASSIGNMENT-GENERATION-SEMANTICS-001 resolved**: `hub/authorization.ts` compares the presented generation with the *terminal's own* projected `terminal_device.assignment_generation` only; the Hub's `hub_assignment.assignment_generation` is a separate device counter (as the cloud and the pairing/eligibility paths already treat it). Required before any command can run on the real Hub (Hub 5, terminals 1 and 4).
3. **Money contract for the Store is authored in the cloud** as a `kitluy_config.configuration_versions` row (`config_key = "laundry.money.v1"`, scope `store_location`, PUBLISHED) and delivered through the same signed path as the catalog: `currency_code KHR`, `currency_exponent 0`, `weight_rule { increment_kg: 1, rounding: "up", minimum_kg: 1 }`, `money_rounding: "round_half_up_minor_unit"`, `fx: { USD: { khr_per_usd: <integer>, effective_from } }`, `location_code` (= `store_locations.location_code`, e.g. `DEMO-PP-01`), optional `express_surcharge_bps`. The Hub refuses to price without it (existing `loadStoreMoneyContract`). The owner supplies the USD rate; nothing defaults.
4. **Standalone repositories stay reference sources.** New schema lands as monorepo migrations (cloud `0233+`, Hub `0045+`); the price list is loaded from a JSON derived from the donor fixture through a development loader, replaceable later by the Partner Portal.

## 3. Target flow after this plan (T1)

```
Pi T1 (face)                     Store Hub                         Cloud (kitluy-fresh)
catalog + money from the signed  ← publishes snapshot sections   ← door 0233: services, prices,
configuration (parsed, IPC)        terminal_profiles/pricing/       money config for the Hub's Store
                                   catalog (hub-sync, hash-gated)
Items → Customer → Pricing(quote)→ /quote: engine prices lines
Review → Confirm & Print         → /confirm-intake: draft→booking,
                                   lines, status, cash (+USD leg),
                                   receipt, print job; outbox facts → (slice 4) ingestion doors →
receipt printed on USB ESC/POS     `laundry.booking_confirmed` …       kitluy_orders/… → Partner Portal
```

## 4. Slices (each ends released to the Pi, verified on hardware, documented)

### Slice 1 — The real catalog and the money contract reach the terminal
- **Cloud**: development loader `scripts/development/load-laundry-catalog.mjs` reading `scripts/development/fixtures/laundry-catalog.designed.json` (derived once from the donor `laundryItemCatalog.ts`: 15 per-piece items × {Dry Clean, Wash & Press} = 30 `PER_PIECE` services with KHR prices, `WASH_FOLD` `PER_WEIGHT` 4,000 KHR/kg, 5 categories, 24 Wash & Fold garment-checklist types, Khmer names where the donor had them) → upserts `kitluy_core.catalog_items` (+ `catalog_item_translations` km/en), `kitluy_laundry.services`, `service_prices` (Store base book, KHR), and the `laundry.money.v1` configuration version (PUBLISHED). Idempotent; codes are the keys. Categories and garment types live in `catalog_items.metadata` / a small `kitluy_laundry.garment_types` table (migration 0233) — vocabulary, not prices.
- **Cloud door** (migration 0233): `read_hub_terminal_projections_v1` grows a `catalog` object (active services, effective KHR prices with location precedence KBR-PRC-002, categories, garment types, `content_hash`) and `money` (the published `laundry.money.v1` payload). Same Hub-identity predicate and scope.
- **Producer + Hub**: the hub-sync envelope carries `catalog` and `money`; `hub/terminal-sync/apply.ts` publishes a snapshot with sections `terminal_profiles`, `pricing` (= money), `catalog` (schema `kitluy.config.catalog.v1`) when grants OR the catalog/money hash changed (`publishDevelopmentConfiguration` becomes multi-section). Hub image trust/URL unchanged.
- **Terminal**: `edge-machine.ts` parses `payloadJson` after the digest check into typed sections (`packages/terminal-local-store` gets `readConfigurationSections`); `electron/intake-ipc.ts` exposes `kitluy:t1:configuration:catalog`; `face/ports.ts` `readCatalog` answers `delivered` (`perPiece`, `perWeight`, `garmentTypes`, `configurationVersion`, `money`). `Step1Items` renders the designed grid with real KHR prices; the per-kg lane uses the delivered rate and the configured whole-kg rule (display only).
- **Tests**: door probe (SQL), loader idempotence, apply publishes on hash change only, terminal parse/IPC, face over delivered catalog (extend `laundry-face.test.tsx`). Release to the Pi; screenshot of the Items step with real prices.

### Slice 2 — A real Booking on the Store Hub, paid in cash, with a receipt record
- **Hub**: fix `authorization.ts` (decision 2). Serve `POST /edge/v1/laundry/bookings/drafts/{draftId}/quote` and `POST /edge/v1/laundry/bookings/{draftId}/confirm-intake` in `edge/routes.ts` through `executeHubCommand` (new command `laundry.booking.confirm_from_draft` composed of existing handlers: `createBookingDraft`→lines via `addBookingLine` with `weightRoundingRule` from the money section and billable weight = ceil(kg, min 1)→`confirmIntake`→`recordCashPayment` (KHR amount; USD tender leg `currency_code USD`, exponent 2, rate recorded in the payment's outbox fact)→`queueReceiptPrint`). Draft conversion: `booking_draft.lifecycle = 'converted'` + `booking_draft_event` (Hub migration 0045 lifts the guard for that one transition and adds `converted_booking_id`). Booking number `KLB-{LOCATION_CODE}-{YYMMDD}-{SEQ}` from the money section's `location_code`. Outbox facts: `laundry.booking_confirmed.v1`, `payments.cash_recorded.v1`, `documents.receipt_issued.v1`.
- **Terminal**: `Step2Pricing` rebuilt from the donor design over `ports.quote()` (Hub-priced lines, express only if configured), cash keypad KHR + USD (rate from the money section; change in KHR); `Step3Review` → `ports.confirmIntake()` → success screen with booking number and the receipt view; `NewOrder` gate uses Hub totals. Orders view: `GET /edge/v1/laundry/bookings?recent` read route (approved family; read-only) listing today's bookings.
- **Tests**: hub-agent integration (quote/confirm over live mTLS, PRICE_MISMATCH, idempotent replay, USD leg, draft converted once); app e2e (real parts: catalog → quote → confirm → receipt). Hardware: a real booking on the Pi with the owner's cash, rows shown on the Hub.

### Slice 3 — The receipt prints on the Pi's USB thermal printer
- Port the donor's raster renderer (`lib/printing/raster/*`, bilingual Khmer-primary, Code128 = booking number, cash-drawer pulse) into `apps/kitluy-pos-desktop-app/electron/peripherals/receipt-printer.ts` — output ESC/POS bytes to the kernel printer device `/dev/usb/lp*` (no native `usb` module: nothing to cross-compile for arm64 Electron), with a Settings test slip. Terminal image: udev rule granting the POS user the printer node; `KITLUY_PERIPHERAL_SUPPORT` already lists `printer`. Print state reported back to the Hub's `print_job`/`print_attempt`.
- Verify with the owner's printer (vendor/product id read from `lsusb` on the Pi).

### Slice 4 — Bookings visible in the cloud and the Partner Portal
- Hub→cloud transport (development stand-in, same shape as the projection pull): `POST /hub-sync/v1/outbox` on `hub-sync-service.mjs`, Hub-signed, batches of outbox facts; cloud migration 0234 adds governed ingestion doors `kitluy_laundry.ingest_booking_confirmed_v1`, `kitluy_payments.ingest_cash_payment_v1`, `ingest_receipt_issued_v1` writing `kitluy_orders.orders/order_lines`, `kitluy_payments.tenders`, receipts projection (effect-key idempotent, like 0187). Management API `GET /partner/bookings` + a Partner Portal list. Hub acks close the outbox rows.

### Slice 5 — T2 mirror, then T3/T4 (outline; each its own plan)
- T2: the customer-safe projection over the existing display-session routes. T3/T4: garments/bags/tags at confirm (T003), storage positions from configuration, the already-registered ready/pickup session routes, the standalone's booking-level scan model as the reference.

## 5. Files that change (representative)
- Cloud: `supabase/migrations/20260919…_0233_catalog_and_money_projection.sql`, `…_0234_booking_ingestion.sql` (slice 4); `scripts/development/load-laundry-catalog.mjs`, `fixtures/laundry-catalog.designed.json`, `hub-sync-service.mjs`, `hub-sync-contract.mjs`.
- Hub: `services/kitluy-hub-agent/src/hub/terminal-sync/{apply,index}.ts`, `hub/dev-configuration.ts` (multi-section), `hub/authorization.ts` (decision 2), `hub/edge/routes.ts`, `hub/commands/{booking-commands,payment-commands,print-commands,shared}.ts`, new `hub/commands/confirm-from-draft.ts`, `hub/migrations/0045_booking_draft_conversion.sql`; `packages/edge-contracts` (quote route + recent-bookings read).
- Terminal: `apps/kitluy-pos-desktop-app/src/bootstrap/edge-machine.ts`, `electron/{intake-ipc,t1-intake-client,preload}.ts`, `electron/peripherals/receipt-printer.ts` (slice 3), `src/vertical/laundry/face/{ports,types}.ts`, `features/new-order/{Step1Items,Step2Pricing,Step3Review}.tsx`, `packages/terminal-local-store`.
- Image: `infra/edge/raspberry-pi/pi-terminal-image` udev rule (slice 3); Hub image rebuild already pending.
- Docs: decision register entry, WS-12 register statuses (T003 partial, T004/T005 partial), handoffs, evidence.

## 6. Verification
- Per slice: package suites (hub-agent incl. DB integration, app, edge-contracts), `pnpm typecheck`, `pnpm secret:scan`; release `kitluy-terminal` from the clean worktree; the Pi installs it via the update agent; hardware proof screenshots + Hub rows + cloud rows recorded in the handoff.
- End state of slices 1–3: on the Pi, a cashier enters items → sees Hub prices → takes cash (KHR/USD) → the Hub holds the Booking, payment and receipt → the receipt prints. Slice 4: the same booking appears in the Partner Portal.

## 7. Risks / open values
- USD rate value and any express surcharge are owner values in the money configuration — nothing prices in USD until the rate is supplied.
- Printer model behaviour (raster width, cutter, drawer) verified only on the owner's unit.
- KHQR and card stay gated (provider contract, BLK-006); deposits/pay-at-pickup not in these slices (owner chose full cash).
- The other Claude session's uncommitted work (device-shell seat validation, Hub 0044, cloud 0231) is untouched; builds keep coming from the clean worktree.
