# Architecture Deltas

**Filename:** `05_ARCHITECTURE_DELTAS.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** CURRENT · **Authority:** IMPLEMENTATION-EVIDENCE (measured) · **Evidence status:** OBSERVED

## 1. The central delta — data authority is inverted

|                               | Standalone POS apps              | Canonical monorepo                                      |
| ----------------------------- | -------------------------------- | ------------------------------------------------------- |
| Terminal data path            | **Terminal → Supabase (direct)** | **Terminal → Store Hub → cloud (async)**                |
| Files touching Supabase       | **84 / 285** in laundry POS      | **0** in `apps/kitluy-pos-desktop-app`                  |
| Hub/LAN references            | 13                               | `lan-client.ts`, `mdns.ts`, mTLS `/edge/v1`             |
| Durable outbox                | **0 files**                      | Delivered in WS-12 T002 with 3 governed cloud consumers |
| Operational authority offline | Cloud                            | **Store Hub**                                           |

`CLAUDE.md` hard rule 6: _"Never bypass the Store Hub for normal Store
operations — POS terminals do not write directly to Supabase."_
`PROJECT_HOME.md` §3.5: after provisioning the Store Hub is the local
operational authority; internet failure must not stop approved local operations.

**Consequence:** the standalone data layer is not portable. Roughly 29% of the
laundry POS source is coupled to an architecture the canonical project
explicitly rejects. Mission §16 forbids preserving that coupling.

## 2. What this means for "migration"

Only three honest categories exist:

| Category             | Meaning                                                                          | Examples                                                                                                |
| -------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Portable**         | No data-authority coupling; needs version reconciliation only                    | printing builders, raster, numbering, express pricing, scanner service, USB printer, design tokens, OSK |
| **Re-implementable** | Behaviour is valuable; the data path must be rewritten against Hub/API contracts | intake flow, catalog presentation, payment presentation, storage assignment                             |
| **Superseded**       | Canonical already has an equal or stricter implementation                        | terminal identity, device session, custody events, production state machine, T2 state machine, outbox   |

Nothing in the standalone repositories is a drop-in.

## 3. Terminal identity — canonical is stricter

Sources allow the operator to **select** a terminal (`features/terminal-select`,
`features/terminals`). The canonical model forbids it: the WS-12 composition
rule states the installer and user _"can never select or override Tenant,
Digital Store, Location, Hub, environment, terminal profile or assignment
generation."_ T001 delivered an atomic protected-identity writer.

Migrating terminal selection would **regress a locked security property**.
Classified `SUPERSEDE`.

## 4. Vocabulary delta — KLDRV-CONF-001

| Source                                          | Model                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Laundry POS + Drive owner decision `KLDRV-0001` | **Order → Service → Service Item** (`pos.orders`, `pos.order_items`, `laundry.garments`, `catalog.services`) |
| Canonical monorepo                              | **Laundry Booking** (`booking-lifecycle`, `custody-events`, WS-12 booking drafts)                            |

Both are owner authority at the same level, scoped to different repositories.
This is not a naming preference — it determines schema, API contracts, events
and audit records. **Unresolved; blocks F-30, F-40, F-41.**

## 5. T1–T4 completeness delta

| Terminal | Laundry POS            | Canonical                                 |
| -------- | ---------------------- | ----------------------------------------- |
| T1       | 64 files (substantial) | T001+T002 complete; T003–T008 not started |
| T2       | 5 files                | `t2-display-state-machine` present        |
| T3       | **2 files**            | not started                               |
| T4       | **1 file**             | not started                               |

The standalone app does **not** contain a usable T3/T4 implementation. The
mission's assumption that these can be migrated is not supported by evidence.

## 6. Toolchain delta

|                 | Monorepo catalog | Laundry    | Suite      |
| --------------- | ---------------- | ---------- | ---------- |
| React           | 18.3.1           | ^18.3.1 ✅ | ^19.2.6 ❌ |
| Vite            | 6                | ^6.0.3 ✅  | ^8.0.12 ❌ |
| TypeScript      | 5.7.3            | ~5.6.3 ⚠   | ~6.0.2 ❌  |
| Electron        | ^33.3.1          | ^40.4.1 ❌ | ^40.4.1 ❌ |
| Package manager | pnpm 9.15.9      | npm        | npm        |

**Electron differs for both sources** (33 vs 40) — main-process and preload code
cannot be assumed compatible. Catalog rule: versions are pinned in
`pnpm-workspace.yaml`; leaves never pin duplicates.

## 7. Core-neutrality risk

`packages/` is neutral Core and must never contain Laundry terminology. The
laundry POS mixes neutral and vertical concerns freely (e.g. `lib/printing/`
contains both a generic `receiptBuilder` and a laundry-specific
`garmentSlipBuilder`). Any migration must split these, not move directories.

## 8. Money

The canonical rule is **no floating-point money — use `@kitluy/money`**. The
sources implement FX (`paywayUsdFromKhr`, `exchangeRate.service`) without that
guarantee. Any migrated pricing/payment code must be converted, not copied.

## 9. Database authority

Do **not** copy standalone migrations into `supabase/migrations/`. The canonical
chain (86 `.sql`) is authoritative. `kitluy-suite-supabase` holds 21 on a
separate lineage — **KLDRV-CONF-004**, unresolved. Never replay historical
migrations or duplicate numbers.
