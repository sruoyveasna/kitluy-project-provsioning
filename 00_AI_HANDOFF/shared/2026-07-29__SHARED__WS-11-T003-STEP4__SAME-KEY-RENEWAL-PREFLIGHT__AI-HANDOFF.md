# Same-key renewal preflight and reservation — AI Handoff

| Field           | Value                                                             |
| --------------- | ----------------------------------------------------------------- |
| Task ID         | WS-11-T003 Step 4 — Prompt 2B-1 (same-key preflight, narrow unit) |
| Date / timezone | 2026-07-29 · Asia/Phnom_Penh                                      |
| Repository root | `C:\dev\HET-KITLUY-PROJECT`                                       |
| Starting SHA    | `8b9ecb7`                                                         |

## Scope

**In:** incumbent credential loading; real Ed25519 chain verification; renewal
eligibility; governed `reuse_current_key` renewal reservation; focused unit and
live-PostgreSQL integration tests.

**Out, and deliberately absent rather than stubbed:** credential preparation,
signing and finalization; key rotation; provider activation; lifecycle
reconciliation; overlap expiry; independent review.

## Sources inspected

`PROJECT_HOME.md`, the authority pack, `00_AI_HANDOFF/000_INDEX.md`,
`certificate-validity.ts`, `certificate-renewal.ts`, `trusted-time.ts`,
`dev-crypto.ts`, `issuance-adapter.ts`, `replacement-key-pop.ts`,
`test/support/dev-database.ts`, migrations 0120-0121 and 0125-0130,
`supabase/tests/assertions.sql`.

## Authority applied

KLD-2026-07-28-002 §4, §5, §6, §7, §12.6; the owner renewal instruction of
2026-07-29; migration groups 0125, 0127, 0129, 0130. Migration 0129's recorded
correction — §5.1 was a RECOMMENDATION, not a ruling — is why `reuse_current_key`
proceeds while `rotate_key` stays disabled pending
`[REQUIRED: renewal_key_rotation_owner_decision]`.

## Files created / changed

| File                                                                   | Change                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/device-identity/src/same-key-renewal-preflight.ts`           | NEW — `prepareSameKeyCredentialRenewal` and its repository/gateway boundaries            |
| `packages/device-identity/src/dev-crypto.ts`                           | `tbsFromCanonicalBytes` — parses a stored canonical TBS back into a verifiable structure |
| `packages/device-identity/src/index.ts`                                | re-export                                                                                |
| `packages/device-identity/test/same-key-renewal-preflight.test.ts`     | NEW — 47 focused unit tests                                                              |
| `.../same-key-renewal-preflight.integration.test.ts`                   | NEW — 15 LIVE PostgreSQL tests                                                           |
| `packages/device-identity/test/support/renewal-fixtures.ts`            | NEW — governed-path fixtures and pg adapters (test-only)                                 |
| `supabase/migrations/…0131_issuance_service_schema_usage.sql`          | NEW — grants schema USAGE to the named executor; see the defect below                    |
| `supabase/tests/assertions.sql`                                        | +section 36 (two cases) — the executor boundary, asserted AND executed as the role       |
| `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md` | component record, KLRISK-DEVICE-004, out-of-scope findings                               |
| `00_AI_HANDOFF/000_CURRENT_STATE.md`                                   | verification and migration rows refreshed                                                |

## What the operation does

```
trusted time -> credential head -> incumbent credential -> stored chain
  -> REAL Ed25519 verification -> renewal eligibility -> provider key
  -> governed reservation (reuse_current_key) -> frozen reservation
```

- **The incumbent is derived, never accepted.** The repository fetches by
  GENERATION, from the authoritative head. `assertedCurrentCredentialId` is only
  COMPARED; it is never used to look anything up.
- **No caller-supplied trust.** No `signatureValid`, no `isVerified`, no
  injectable verifier. `state = 'issued'` is bookkeeping, not evidence.
- **The result carries no verified boolean** — only
  `consumersMustReVerifyAtAuthenticationBoundary`.
- **The reservation is built by the DATABASE.** Nothing in TypeScript allocates
  an attempt id, a next generation or a head version.

## Commands executed (with actual results)

| Command                               | Exit | Result                                                                      |
| ------------------------------------- | ---- | --------------------------------------------------------------------------- |
| `pnpm db:reset`                       | 0    | 0000→0131 applied from zero; 0131's hostile assertions passed at apply time |
| `pnpm db:seed`                        | 0    | seeded                                                                      |
| `pnpm db:test`                        | 0    | **176 PASS** (baseline 174 + the two new section-36 cases)                  |
| `pnpm test:rls`                       | 0    | **104 PASS** (baseline unchanged)                                           |
| device-identity `vitest run`          | 0    | **308 passed / 0 skipped**, 15 files (246 baseline + 47 unit + 15 live)     |
| live renewal-preflight suite          | 0    | **15 EXECUTED**, 0 skipped                                                  |
| `pnpm typecheck`                      | 0    | 89/89                                                                       |
| `pnpm lint`                           | 0    | 0 errors, 2 pre-existing warnings                                           |
| `pnpm secret:scan`                    | 0    | clean, 1114 tracked files                                                   |
| `pnpm clock:check --require-complete` | 0    | PASS, COMPLETE 4/4                                                          |
| `pnpm docs:verify` (8 steps)          | 0    | **8/8 PASS** (run individually — see toolchain note)                        |
| `pnpm verify` (12 steps)              | —    | **11/12 PASS**; `format:check` FAILS on a pre-existing file (see below)     |

**TOOLCHAIN DEVIATION — read before citing these figures.** The repository pins
Node `>=22.12.0 <23` with `engine-strict=true`. Only **Node v24.15.0** is
installed on this machine. `pnpm verify` and `pnpm docs:verify` could not be
invoked as aggregates, because their nested `pnpm` children re-read the project
`.npmrc`; every constituent step was therefore run individually with the engine
check relaxed via an environment override (no repository or user config was
modified). These results were NOT produced on the ACTIVE-BASELINE Node 22.23.0.

## Migration added — and why it was necessary

`0131_issuance_service_schema_usage`. Not added for TypeScript convenience.

Groups 0127-0130 created `kitluy_issuance_service` as THE named executor and
granted it EXECUTE on every governed function. **None granted it USAGE on the
schema those functions live in**, and EXECUTE does not permit name resolution —
so every governed call made AS THE INTENDED ROLE failed with
`permission denied for schema kitluy_devices`.

It survived four migration groups and 174 passing assertions because every test
ran as `postgres`, which inherits schema USAGE through `service_role`. The gap
appeared the first time a test did `set local role kitluy_issuance_service`,
which is exactly the check the Step 4 instruction required.

The migration is additive and grants USAGE only — no CREATE, no table
privilege, no role membership — and carries hostile assertions that fail the
migration if the boundary widens.

## Tests: passed / failed / not run

All added tests pass. One gate fails and one database branch could not be
reached:

- **`format:check` fails on `R&D_HSA_AI_Agent_MVP.md`** — a tracked file this
  session did not touch, which fails `prettier --check` identically at
  `8b9ecb7`. PRE-EXISTING, not a regression. Not fixed: out of scope, and a
  repository-wide format run is prohibited (hard rule 1).
- **`KLUY-RENEWAL-REVOKED-REQUIRES-RECOVERY` cannot be driven.** No governed
  function moves a credential into `revoked`, and `postgres` cannot write the
  table (probed: `permission denied for table device_credentials`). The revoked
  path is covered instead through device containment via
  `quarantine_device_v1` — a real signal, but a different one.

## Security findings

Preserved and asserted: private keys stay inside `DeviceKeyProvider` (no export
method exists); no private-key serialization; no caller-supplied cryptographic
verdict; no direct credential-table or credential-head writes; NOLOGIN
governors; no login-capable governor membership; no `PUBLIC EXECUTE`; fixed
`search_path`; RLS ENABLE and FORCE; non-X.509 credential classification;
development-only Ed25519; `production_eligible = false`; rotation disabled by
default. `pgsodium` was NOT installed.

New: **KLRISK-DEVICE-004** (the executor could never execute) — closed by 0131
with assertions in both the migration and the permanent suite.

Generalized lesson recorded: a privilege matrix can be right in the catalogue
and wrong in practice. Any future governed role must be tested by ASSUMING it,
never by executing as a superset that inherits its grants.

## Known limitations

No credential issuance for renewal. No key rotation. No provider activation. No
lifecycle promotion. No independent review of this unit. `KLRISK-DEVICE-003`,
`KLRISK-REPO-001` and `KLRISK-REPO-002` remain OPEN.

## Current implementation status (evidence register delta)

**Same-key renewal preflight and reservation — IMPLEMENTED-IN-DEV component.**

Nothing else advances. WS-11 stays SCAFFOLDED / IN PROGRESS, WS-11-T003 Step 4
is NOT complete, and no renewal orchestration or lifecycle claim is made.

## Recommended next task

Prompt 2B-2 — same-key prepare, sign and finalize.
