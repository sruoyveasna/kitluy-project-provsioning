# Target Monorepo Inventory — `het-kitluy-project`

**Filename:** `03_TARGET_MONOREPO_INVENTORY.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** EVIDENCE · **Authority:** IMPLEMENTATION-EVIDENCE · **Evidence status:** OBSERVED

## 1. `apps/kitluy-pos-desktop-app/` — the migration target

73 files including build output. Actual source:

```text
src/        App.tsx · main.tsx · bootstrap-view.tsx
electron/   main.ts · preload.cts · t1-runtime.ts · terminal-identity.ts
            terminal-store.ts · lan-client.ts · mdns.ts
            intake-ipc.ts · t1-intake-client.ts
test/       t1-bootstrap.acceptance · t1-startup.e2e.integration
            t1-endpoint-order · terminal-identity · hub-time · mdns
            t002-intake-machine · smoke
```

This is a **fail-closed scaffold with live WS-12 T1 work**: real Hub bootstrap
over mTLS, mDNS `_kitluy-edge._tcp.local` discovery with locked endpoint order,
terminal identity, and the T002 intake state machine. It is **Hub-mediated by
construction** — `lan-client.ts` and `mdns.ts`, no Supabase client.

**This is the architectural inverse of both standalone POS apps.**

## 2. `verticals/phase1-laundry/`

Source modules: `booking-lifecycle`, `production-state-machine`,
`t2-display-state-machine`, `custody-events`, `terminal-profiles`, `pricing`.
Tests: `booking-lifecycle`, `production-state-machine`, `laundry`.

The Laundry domain model already exists here as **Booking**-centred state
machines — not Order/Service/Service Item.

## 3. Scale

| Area                | Count     |
| ------------------- | --------- |
| Workspace packages  | 87        |
| Apps                | 8         |
| Services            | 19        |
| Shared packages     | 43        |
| Verticals           | 9         |
| Supabase migrations | 86 `.sql` |
| Documentation       | 294       |

## 4. Relevant existing packages

`@kitluy/` — `pos-ui`, `printing`, `hardware`, `terminal-local-store`,
`sync-protocol`, `edge-contracts`, `money`, `localization`, `payments`,
`payments-persistence`, `pricing`, `catalog`, `customers`, `rbac`, `auth`,
`approvals`, `audit`, `device-identity`, `configuration-snapshots`,
`release-manifests`, `resource-scope`, `tenant-context`, `digital-store-context`.

**Homes already exist for every capability found in the standalone apps.** The
gap is contract conformance, not missing structure.

## 5. Active cycle — WS-12 (governs what may be built)

Owner decision `KLD-2026-08-06-WS12-TASKS-001` locks eight tasks **in order**:

| Task | Scope                                              | Status                            |
| ---- | -------------------------------------------------- | --------------------------------- |
| T001 | T1 Runtime, Device Session, Store Hub Bootstrap    | **COMPLETE** (IMPLEMENTED-IN-DEV) |
| T002 | Customer Identity, Consent, Booking Draft          | **COMPLETE** (IMPLEMENTED-IN-DEV) |
| T003 | Service, Garment, Evidence, Custody Intake         | **NOT STARTED**                   |
| T004 | Pricing, Capacity, Due-Time, Booking Confirmation  | NOT STARTED                       |
| T005 | Deposit, Payment, KHQR, Receipt, Tag Issuance      | NOT STARTED                       |
| T006 | Offline Queue, Sync, Printing, Peripheral Recovery | NOT STARTED                       |
| T007 | T1 Workflow Integration, Localization, E2E         | NOT STARTED                       |
| T008 | Independent Review, Rebuild Evidence, Closeout     | NOT STARTED                       |

**Composition rule (LOCKED):** T1 is an operational client and composition
surface, **not a new source of Booking, payment, pricing, customer or audit
truth**. The Store Hub is never bypassed; terminals never write to Supabase.

The most recent closure states plainly: _"T1 still creates no Booking, pricing,
payment, receipt or printing."_
