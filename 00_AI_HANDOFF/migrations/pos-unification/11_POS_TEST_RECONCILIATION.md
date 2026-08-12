# POS Test Reconciliation

**Filename:** `11_POS_TEST_RECONCILIATION.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** CURRENT · **Authority:** IMPLEMENTATION-EVIDENCE

## 1. Canonical POS test surface

|            | Before               | After                    |
| ---------- | -------------------- | ------------------------ |
| Test files | 8 (+1 skipped e2e)   | **9** (+1 skipped e2e)   |
| Tests      | 58 passed, 1 skipped | **72 passed, 1 skipped** |

New: `test/vertical-host.test.ts` — 14 tests covering registry composition,
per-profile experience resolution for all four T1–T4 profiles, Phase 2
containment (two independent gates), and five fail-closed refusals.

New package suite: `packages/digital-store-context/test/vertical-resolution.test.ts`
— 16 tests covering profile-code parsing, registry narrowing, the authorised
path, and six refusal codes.

## 2. Donor test assets — disposition

| Donor test                                                    | Portability | Disposition                                                           |
| ------------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| `numbering.test`, `formatters.test`, `express.test` (pricing) | Portable    | Port with their feature (T004)                                        |
| `orderModes.test`, `integrationStatus.test`                   | Conditional | Verify vocabulary against KLDRV-CONF-001 first                        |
| `auth.service.test`, `terminals.service.test`                 | **Rewrite** | Test a superseded architecture (direct Supabase, selectable terminal) |
| `data/**` repository tests                                    | **Rewrite** | Assert direct-Supabase repositories                                   |
| `provisioningState.test`                                      | **Rewrite** | Canonical forbids user-selectable provisioning                        |
| `identifier-roundtrip.test`                                   | Assess      | May encode Order/Service identifiers                                  |

**Ported this cycle: 0** — no donor test covers vertical resolution, because the
capability did not exist in either donor.

## 3. Rules observed

- No existing test was disabled, skipped or weakened.
- The one pre-existing skip (`t1-startup.e2e.integration`) self-skips when the
  local Hub database is unreachable; that behaviour is unchanged.
- No assertion was relaxed to make anything pass.
- New tests assert **refusals**, not just happy paths — the fail-closed
  properties are the ones worth pinning.

## 4. Baseline comparison

| Suite                     | Baseline               | Final                  | Delta    |
| ------------------------- | ---------------------- | ---------------------- | -------- |
| `pnpm verify`             | 10 PASS / 3 FAIL       | 10 PASS / 3 FAIL       | **none** |
| `pnpm docs:verify`        | 7 PASS / 1 FAIL        | 7 PASS / 1 FAIL        | **none** |
| `pnpm secret:scan`        | PASS (1,458)           | PASS (1,458)           | **none** |
| `@kitluy/device-identity` | 85 failed / 757 passed | 85 failed / 757 passed | **none** |
| Format failures           | 48                     | 48                     | **none** |

The three failing gates are the documented pre-existing ones. **No new failure
was introduced.**
