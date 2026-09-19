# 52 — The real catalog and the money contract reach the Pi Terminal (T1-REAL-OPERATIONS-001, slice 1)

**Date** 2026-09-19 · **Area** edge-platform / laundry · **Status** IMPLEMENTED · TESTED · RELEASED to the development Terminal (`0.1.0-catalog-202609191140`, `fae08e69…`) · HARDWARE VERIFIED (the running POS reads the catalog and money from its verified configuration; the Items grid itself needs the owner's PIN to be seen) · **Commits** `e478925` on `dev` (worktree `4b9c069`). Plan: `docs/decisions/kitluy-t1-real-operations-plan-owner-decision-v1.0.0.md` (KLD-2026-09-19-T1-REAL-OPERATIONS-001).

## 1. What this slice does

The designed price list (30 per-piece services in two families — Dry Clean, Wash & Press — plus Wash & Fold at 4,000 KHR/kg, 5 categories, 24 garment-checklist types) now travels **cloud → Store Hub → Pi Terminal** on the only path the architecture allows: WS-05 tables → the Hub-identity-authenticated projection door → the Hub's SIGNED configuration snapshot → the terminal's digest-checked delivery → the face. No fixture, no default, no price invented anywhere; the Store's money contract (KHR, exponent 0, whole-kg-up minimum 1, location code, optional FX and express) rides beside it as the Hub's own `pricing` section, so what the face shows is what the Hub will charge in slice 2.

## 2. What exists now

| Tier | Piece |
| --- | --- |
| Cloud (group 0233) | `kitluy_laundry.service_families / catalog_categories / garment_types` (vocabulary, never a price; RLS enable+force; governor read policies); `read_hub_terminal_projections_v1` grows `catalog` (effective KHR price per service for the Hub's Location — Location book over Store base book, KBR-PRC-002 — with `content_hash`) and `money` (the Location's PUBLISHED `laundry.money.v1`). Applied on `kitluy-fresh` and `repo17`. |
| Loader | `pnpm dev:catalog:load` (`scripts/development/load-laundry-catalog.mjs`, file `fixtures/laundry-catalog.designed.json`): idempotent by code; a price change closes the open window and opens a new one; `--pause-others`; `--khr-per-usd` is the ONLY way FX enters. Run on `kitluy-fresh`: 31 services active, the two demo services paused, `laundry.money.v1` v1 published for `DEMO-PP-01`. |
| Producer + Hub | envelope carries `catalog` + `money`; the Hub verifies their shape, publishes `terminal_profiles + pricing + catalog` in one signed snapshot (`publishDevelopmentConfiguration({ extraSections })`) and republishes only when grants, catalog hash or money changed. Hot-deployed `hotfix-4b9c069` (sha256 `2a9e8c12…`). |
| Terminal | `PiTerminalRuntime.configurationRead()` hands the VERIFIED sections over `kitluy:t1:configuration:read` (preload `kitluyT1Configuration`, read-only, no input); `src/bootstrap/configuration-sections.ts` (neutral), `src/vertical/laundry/catalog-section.ts` (closed shape; `billableKilograms` as data); `face/ports.ts` `catalogAnswerFromSections`; one card per delivered family (Khmer name beneath), the per-piece grid per family with real prices, the kg offering, the garment checklist. |

## 3. Proof

- Tests: hub-agent terminal-sync 23 + integration 10 (sections published; unchanged → nothing; catalog hash alone → `because catalog`; FX alone → `because money`); app 161/2 skipped incl. `laundry-catalog-delivery` 7; Hub image static suites unchanged.
- Hardware 2026-09-19 11:20–11:50 +07:00: producer `KL-CFADA8C75001: 2 terminal(s) · catalog 31 services 6707ae28d74d · money published`; Hub `terminal sync applied … configuration: v6 (6 grants; terminal_profiles+pricing+catalog; because catalog,money)`; active snapshot v6 sections `catalog` 21,797 B / `pricing` 240 B / `terminal_profiles`; both terminals stayed SERVING and moved to configuration v6. Terminal `KL-54A3320E1201` installed and committed `0.1.0-catalog-202609191140`; over DevTools in the running POS, `window.kitluyT1Configuration.read()` answered `delivered v6` with `catalog` (31 services; families "Wash & Fold / បោកបត់", "Dry Clean / បោកស្ងួត", "Wash & Press / បោកអ៊ុត"; `WF-KG 4000`, `DC-SUIT_2PC 25000`, `DC-DRESS_SHIRT 8000`; 24 garment types) and `pricing` (KHR, whole-kg-up min 1, `DEMO-PP-01`, no FX yet). Diagnostic drop-in removed afterwards.

## 4. Lessons of the run (recorded so they are not paid twice)

- `release-publish.mjs` packs the PRE-BUILT `apps/kitluy-pos-desktop-app/release-payload/`; run `pnpm --filter @kitluy-apps/kitluy-pos-desktop-app build:release-payload` in the release worktree first, or the previous payload ships under a new version (`310eefda…`, `0.1.0-catalog-202609191100`, is such a stale re-pack — superseded, harmless).
- The release service serves bytes from the MAIN tree's `build/releases/<id>/`; a worktree publish must copy its `build/releases/<id>/` there, or the update agent refuses `ARTIFACT_SOURCE_UNAVAILABLE`.
- The worktree's untracked image-build leftovers (`infra/edge/raspberry-pi/pi-terminal-image/build` symlink, `build.worktree-own/`) make `buildId` read `-dirty`; the content is the clean commit. Owner approval requested to remove them.
- The board has no `ss`; read `/proc/net/tcp` (`:2406` = 9222).

## 5. Open / next

- Slice 2 (a real Booking on the Hub: quote → confirm → cash KHR/USD → receipt record) needs the owner's KHR/USD rate (`pnpm dev:catalog:load --khr-per-usd <rate>` republishes the money contract; the Hub picks it up within a minute).
- The old terminal `KL-1CB3577C26A7` keeps its previous release until assigned (auto-assign covers only terminals with nothing assigned).
- Hub image rebuild (hub-sync + these bundles) still pending after the owner's first-boot scenario.
