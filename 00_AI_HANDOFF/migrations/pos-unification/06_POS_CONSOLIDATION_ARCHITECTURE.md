# POS Consolidation Architecture

**Filename:** `06_POS_CONSOLIDATION_ARCHITECTURE.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner · **Status:** CURRENT
**Authority:** OWNER-LOCKED (owner decision 2026-08-07 §2, §3, §5, §17, §18) + IMPLEMENTATION-EVIDENCE (built)
**Evidence status:** **MIGRATED-NOT-YET-ACCEPTED** — implemented and tested in dev; marks no WS-12 task complete

## 1. The architecture

```text
                    ONE
          KitLuy POS Desktop App
                     │
                     ▼
              Shared POS Shell
        (Electron · Hub client · identity · bootstrap)
                     │
                     ▼
            Vertical Resolver          @kitluy/digital-store-context
        (authoritative, fail-closed)
                     │
                     ▼
            Vertical Registry          apps/…/src/vertical/
                     │
        ┌────────────┼─────────────┐
        ▼            ▼             ▼
     Laundry    Café/Restaurant   Future
   ACTIVE_PHASE1  REGISTERED_    (reserved
                  INACTIVE_PHASE2  boundaries)
```

**One executable. One shell. One update mechanism. Many vertical experiences.**
No `laundry-pos-app`, `cafe-pos-app` or similar was created.

## 2. Runtime resolution chain — implemented

```text
device identity
   → assigned Store Hub (mTLS /edge/v1)
   → Hub-signed configuration envelope
   → tenantId · digitalStoreId · storeLocationId · terminalDeviceId
   → terminalProfileCode  (e.g. laundry.t1.intake_cashier)
   → vertical             (derived from the signed profile prefix)
   → phase gate check     (PHASE_GATES)
   → vertical module      (registry)
   → terminal experience  (profile match)
```

Every input originates in the **Hub-signed** envelope. The vertical is never
inferred from hostname, IP address, screen size, a local dropdown,
`localStorage` or a hand-edited file.

## 3. Reused canonical registry — nothing invented

Owner decision §17 says to use the canonical registry if one exists. It does:

| Concept                | Canonical home                                                    | Status       |
| ---------------------- | ----------------------------------------------------------------- | ------------ |
| Eight locked verticals | `VERTICAL_PHASES` / `VerticalKey` in `@kitluy/shared-types`       | pre-existing |
| Phase gates            | `PHASE_GATES` / `isVerticalActive` in `@kitluy/feature-flags`     | pre-existing |
| Laundry T1–T4 profiles | `LAUNDRY_TERMINAL_PROFILES` in `@kitluy-verticals/phase1-laundry` | pre-existing |

`VerticalKey` already matches the owner's enum exactly — `laundry`,
`cafe_restaurant`, `ecommerce`, `convenience`, `pharmacy`, `department_store`,
`grocery`, `supermarket`. **No new enum was introduced.**

## 4. Vertical resolver — `@kitluy/digital-store-context`

The package's stated purpose was already _"one primary vertical per Digital
Store"_; it was `SCAFFOLDED`. It now implements that boundary.

`resolveStoreContext(assignment) → Result<ResolvedStoreContext>`

Fail-closed refusals:

| Code                                       | Refuses when                                            |
| ------------------------------------------ | ------------------------------------------------------- |
| `digital_store.assignment.incomplete`      | tenant / store / location / device missing              |
| `digital_store.terminal_profile.malformed` | profile code is not `<vertical>.<terminal>.<role>`      |
| `digital_store.vertical.unknown`           | value is outside the eight-phase registry               |
| `digital_store.vertical.profile_mismatch`  | declared vertical contradicts the signed profile prefix |
| `digital_store.vertical.not_active`        | vertical registered but phase gate is not ACTIVE        |
| `digital_store.vertical.no_evidence`       | no vertical evidence at all                             |

**Neutral Core.** No vertical-specific terminology or behaviour — it knows
nothing of garments or tables.

### The recorded evidence gap

The signed envelope carries **no explicit vertical field**. Rather than invent a
Hub contract change, the resolver derives the vertical from the Hub-signed
`terminalProfileCode` prefix, which is itself authoritative. It also accepts an
optional `declaredVertical` for when the envelope gains one, and **refuses if the
two disagree** — it never silently prefers one. Recorded as
`VERTICAL_EVIDENCE_NOTE` in the source.

## 5. Vertical registry and host — `apps/…/src/vertical/`

| File          | Role                                                                                    |
| ------------- | --------------------------------------------------------------------------------------- |
| `contract.ts` | `VerticalModule`, `VerticalTerminalExperience`, `VerticalModuleState`, host refusals    |
| `registry.ts` | `VerticalRegistry` — immutable, explicit registration, fail-closed `resolve()`          |
| `modules.ts`  | `LAUNDRY_MODULE` (ACTIVE_PHASE1), `CAFE_RESTAURANT_MODULE` (REGISTERED_INACTIVE_PHASE2) |
| `index.ts`    | public surface                                                                          |

Registration is **compiled in, not discovered** — a rogue local file cannot
introduce an experience. This is an internal modular architecture, deliberately
**not** an externally installable plugin system (§18).

### Defence in depth against Phase 2 leaking into Phase 1

Two independent gates must both agree before an experience loads:

1. `PHASE_GATES` — `cafe_restaurant` is `REGISTERED_INACTIVE`, so the resolver
   refuses with `digital_store.vertical.not_active`.
2. `VerticalModule.state` — the host refuses `MODULE_NOT_ACTIVE` even if a gate
   were misconfigured.

Both paths are test-pinned.

## 6. Boundary rules honoured

**Shared shell** (neutral): Electron lifecycle, device identity, Hub client,
LAN discovery, configuration, bootstrap, vertical resolution, registry.

**Vertical** (outside neutral Core): Laundry booking lifecycle, custody events,
production and T2 display state machines, terminal profiles — all already in
`verticals/phase1-laundry`. Café/restaurant material stays behind the Phase 2
boundary.

`packages/digital-store-context` contains **no** Laundry or restaurant
terminology, satisfying the neutral-Core rule.

## 7. What this deliberately does NOT do

- It does not mark WS-12 T003–T008 complete. It creates no Booking, pricing,
  payment, receipt or printing behaviour.
- It does not activate Phase 2.
- It does not migrate donor UI or data layers — those remain gated (see
  `10_POS_FEATURE_DISPOSITION_REGISTER.md`).
- It does not change the Hub contract or any signed envelope.
