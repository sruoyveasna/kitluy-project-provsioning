# POS Source Traceability

**Filename:** `08_POS_SOURCE_TRACEABILITY.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** CURRENT · **Authority:** IMPLEMENTATION-EVIDENCE

> Essential because the donor repositories will eventually be deleted from the
> live workspace. Their history is preserved in verified bundles — see
> `../standalone-retirement/RECOVERY_ARTIFACT_REGISTER.md`.

## Unit P00 — vertical resolution, registry and module registration

| Field                     | Value                                                                                                                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Source repository**     | None — new canonical implementation                                                                                                                                                                                                                            |
| **Derived from**          | Owner decision 2026-08-07 (POS unification) §2, §3, §5, §7, §17, §18                                                                                                                                                                                           |
| **Reused canonical**      | `@kitluy/shared-types` (`VERTICAL_PHASES`, `VerticalKey`, `Result`), `@kitluy/feature-flags` (`PHASE_GATES`, `isVerticalActive`), `@kitluy-verticals/phase1-laundry` (`LAUNDRY_TERMINAL_PROFILES`)                                                             |
| **Target files**          | `packages/digital-store-context/src/index.ts` · `packages/digital-store-context/test/vertical-resolution.test.ts` · `apps/kitluy-pos-desktop-app/src/vertical/{contract,registry,modules,index}.ts` · `apps/kitluy-pos-desktop-app/test/vertical-host.test.ts` |
| **Migration method**      | New implementation against existing canonical registries; no code copied from either donor                                                                                                                                                                     |
| **Adaptations**           | Vertical derived from the Hub-signed `terminalProfileCode` prefix because the configuration envelope carries no explicit vertical field (recorded as `VERTICAL_EVIDENCE_NOTE`, not guessed)                                                                    |
| **Architectural changes** | `@kitluy/digital-store-context` advanced from SCAFFOLDED to implemented; POS shell gained a vertical host; `@kitluy/feature-flags` and `@kitluy/shared-types` added as its dependencies                                                                        |
| **Tests added**           | 16 (resolver) + 14 (host) = **30**                                                                                                                                                                                                                             |
| **Tests ported**          | 0 — no donor test covers vertical resolution; the capability did not exist                                                                                                                                                                                     |
| **Status**                | **MIGRATED-NOT-YET-ACCEPTED**                                                                                                                                                                                                                                  |

### Why no donor code was copied

Both donors resolve their experience from the application identity itself — one
is a laundry app, the other a suite/café app. Neither contains vertical
_resolution_; both contain user-selectable terminal pickers that the canonical
model explicitly forbids (`SUPERSEDE`, F-12). There was nothing to port.

## Donor provenance recorded in code

`apps/kitluy-pos-desktop-app/src/vertical/modules.ts` records, in the module
definitions themselves:

- `LAUNDRY_MODULE.provenance` — canonical `verticals/phase1-laundry` modules, and
  donor `kitluy-laundry-pos-desk-app@d5d1a26` with a pointer to the disposition
  register.
- `CAFE_RESTAURANT_MODULE.provenance` — boundary registration only; donor
  `kitluy-suite-pos-desk-app@3f66249` holds the café implementation, classified
  `REGISTER-INACTIVE`, not yet migrated.

This keeps provenance readable after the donors are gone.

## Donor commits referenced

| Repository                    | Commit    | Relevance                                                             |
| ----------------------------- | --------- | --------------------------------------------------------------------- |
| `kitluy-laundry-pos-desk-app` | `d5d1a26` | Phase 1 implementation donor                                          |
| `kitluy-suite-pos-desk-app`   | `3f66249` | Shared/café donor; head of 3 unpushed commits                         |
|                               | `5c308be` | _port KitLuy Laundry POS UI to Suite POS launcher, PIN, settings, T2_ |
|                               | `2c83025` | _design tokens, touch input pad styles, shared types_                 |
