# Test Reconciliation

**Filename:** `08_TEST_RECONCILIATION.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** CURRENT · **Authority:** IMPLEMENTATION-EVIDENCE · **Evidence status:** OBSERVED

## 1. Test assets in the sources

| Repository                    | Test files                | Notable                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kitluy-laundry-pos-desk-app` | **27**                    | `auth.service.test`, `terminals.service.test`, `formatters.test`, `numbering.test`, `orderModes.test`, `integrationStatus.test`, `provisioningState.test`, `express.test` (pricing), `identifier-roundtrip.test`, repository tests under `data/` |
| `kitluy-suite-pos-desk-app`   | not separately enumerated | thin                                                                                                                                                                                                                                             |

## 2. Canonical test surface

`apps/kitluy-pos-desktop-app/test/` — 8 files: `t1-bootstrap.acceptance`,
`t1-startup.e2e.integration`, `t1-endpoint-order`, `terminal-identity`,
`hub-time`, `mdns`, `t002-intake-machine`, `smoke`.

`verticals/phase1-laundry/test/` — `booking-lifecycle`,
`production-state-machine`, `laundry`.

Repository-wide: `tests/{chaos,contract,end-to-end,hardware,integration,load,offline,recovery,rls,security}`.

## 3. Portability assessment

| Source test                                                   | Portability          | Reason                                                                |
| ------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------- |
| `numbering.test`, `formatters.test`, `express.test` (pricing) | **Portable**         | Pure logic, no data-authority coupling                                |
| `orderModes.test`, `integrationStatus.test`                   | Likely portable      | Verify vocabulary against KLDRV-CONF-001 first                        |
| `auth.service.test`, `terminals.service.test`                 | **Rewrite required** | Test a superseded architecture (direct Supabase, selectable terminal) |
| `data/**` repository tests                                    | **Rewrite required** | Assert direct-Supabase repositories                                   |
| `provisioningState.test`                                      | **Rewrite required** | Canonical forbids user-selectable provisioning                        |
| `identifier-roundtrip.test`                                   | Assess               | May encode Order/Service identifiers — KLDRV-CONF-001                 |

## 4. Tests migrated

**None** — migration is gated (see `06_MIGRATION_PLAN.md`). A test may only move
with the behaviour it verifies.

## 5. Rules for when migration proceeds

- Port tests **with** their feature, in the same WS-12 task.
- Rewrite a test when the target architecture differs — do not weaken assertions
  to make a ported test pass.
- **Never disable a failing test to obtain a green build.**
- Statuses advance only with evidence recorded in the evidence register.
- Compare every run against `00_BASELINE.md`; the three known pre-existing
  failures are not migration regressions.
