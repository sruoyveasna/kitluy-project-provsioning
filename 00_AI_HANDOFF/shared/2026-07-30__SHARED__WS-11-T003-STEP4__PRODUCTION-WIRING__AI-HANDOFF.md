# WS-11-T003 Step 4 — production wiring remediation (group 0155)

| Field           | Value                                                              |
| --------------- | ------------------------------------------------------------------ |
| Task ID         | WS-11-T003 Step 4 — final remediation §2–§5                        |
| Date / timezone | 2026-07-30 · Asia/Phnom_Penh                                       |
| Repository root | C:/Users/Hello-Evo-PC/Desktop/HET-KITLUY-PROJECT                   |
| Start SHA       | `d1a35f3` (34 ahead, clean)                                        |
| End SHA         | `56f8e6f` (38 ahead, clean)                                        |
| Status          | **PARTIAL — Step 4 NOT promoted.** §2/§3/§4-producing/§5 done; §4-Hub, §6, §7 NOT done |

## Sources inspected

`AGENTS.md`, `CLAUDE.md`, `KIMI.md`, `PROJECT_HOME.md`, `00_AI_HANDOFF/000_{INDEX,CURRENT_STATE,ACTIVE_PHASE,BLOCKERS}.md`,
the Phase E promotion-gate handoff and its three review notes, migrations 0146–0154,
`packages/device-identity/src/*`, every `services/*/src`, `hub/migrations/*`,
`services/kitluy-hub-agent/src/hub/sync/configuration.ts`, and the live database catalogue.

## Authority applied

KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.2/§2.4/§2.5 · KLD-2026-07-28-002 §6 ·
KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001 · KL-INF-P1-037 (OWNER-LOCKED) ·
CLAUDE.md rules 2, 4, 5, 7.

## The finding that shaped the whole task

Phase E's RV-GW-001 said the gateway was "library-available-but-uncalled". Live inspection
showed **why**, and it was structural rather than an oversight:

- every cloud service in `services/` except `kitluy-hub-agent` is the **same 91-line,
  3-file health-check kernel with no database access at all** (measured: 18 of 19);
- `evaluateCertificateValidity` also had **zero** production callers;
- `services/kitluy-hub-agent/src/device-identity.ts` is interfaces only — no verification.

So there was nowhere for a governed call to originate. The remediation is a real composition
root in `kitluy-device-registry-service`, which already owns device identity and certificate
records.

## Files created / changed

Migration (additive, next free group):

- `supabase/migrations/20260730190155_0155_production_revocation_composition.sql` — five
  definer bridges + capability census + worker-executed smoke probes + ownership hand-back.

Service (`services/kitluy-device-registry-service/`):

- `src/database.ts` — role constants, `withServiceRole`, `withHumanSession`,
  `observeSessionIdentity`
- `src/revocation-failures.ts` — classification + redaction
- `src/revocation-service.ts` — the four governed doors
- `src/composition.ts` — `resolveDeviceRevocationService` (no seam, no fake)
- `src/online-verifier.ts` — the production revocation join
- `src/lapse-worker.ts` — durable-job handler + worker composition
- `src/revocation-snapshot-builder.ts` — offline snapshot producer + scope binding + union
- `src/main.ts`, `src/index.ts`, `package.json` — wiring and exports
- `test/production-composition.test.ts` (25) · `test/revocation-composition.integration.test.ts` (16)
  · `test/offline-revocation-snapshot.test.ts` (21)

Package:

- `packages/device-identity/src/pg-revocation-lookup.ts` — `loadRevocationsViaGovernedBridge`

## What group 0155 adds, and why each exists

| Function                              | Reachable by       | Why                                                                                                                |
| ------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `lapse_governed_emergency_post_approval_v1` | worker, issuance   | 0152's sweeper takes an ENVIRONMENT — wrong blast radius for an at-least-once job, and forces the worker to choose a value |
| `governed_emergency_status_v1`         | worker, issuance   | reconciliation read without granting the worker SELECT on the authorizations table                                 |
| `revoked_certificate_serials_v1`       | **issuance only**  | so the online verifier need not be globally-BYPASSRLS `service_role`                                               |
| `revoked_device_records_v1`            | **issuance only**  | same; decision §2.5 gives the worker no revocation path                                                            |
| `credential_verification_state_v1`     | worker, issuance   | current head generation/fingerprint and permitted overlap come from the DB, not the presenter                       |

The BYPASSRLS point is the substantive one: the only loginable role with SELECT on
`device_credentials` is `service_role`. Wiring the verifier that way would have worked, and
would have handed the component answering one yes/no question the whole database's row
security — the arrangement group 0140 deliberately moved the approval gate away from.

## Commands executed (actual results)

Canonical order, local cloud database `postgresql://…@127.0.0.1:54322/postgres`:

| Step                              | Result                                                     |
| --------------------------------- | ---------------------------------------------------------- |
| `db:reset` (0000→0155, from zero) | exit 0 — 0155's three notices all fired                    |
| `db:seed`                         | exit 0                                                     |
| `db:test`                         | exit 0 — **196 PASS**                                      |
| `test:rls`                        | exit 0 — **104 PASS**                                      |
| `@kitluy/device-identity` vitest  | **780 passed / 0 skipped (33 files)** — baseline unchanged  |
| device-registry-service vitest    | **67 passed (4 files)** — 21 offline, 25 structural, 16 live, 5 http |
| `typecheck` (both)                | exit 0                                                     |
| `lint`                            | 0 errors, 2 pre-existing warnings                          |
| `secret:scan`                     | clean, 1210 tracked files                                  |
| `clock:check --require-complete`  | COMPLETE                                                   |
| `migrations:validate`             | 54 files PASS                                              |
| `db:validate`                     | exit 0, 3 pre-existing static false positives (see below)  |
| `docs:verify`                     | aggregate FAIL on PATH; 7/8 individually (see below)        |

Effective roles exercised: `kitluy_issuance_service`, `kitluy_worker_service`,
`authenticated` (with transaction-local `request.jwt.claims`), `postgres` (fixtures only).

## Two defects the repository's own assertions caught

Recorded because both would have shipped green:

1. **Group 0155 borrowed `kitluy_credential_issuer` and never handed it back.**
   `ASSERT FAIL: the current login-capable role can SET ROLE kitluy_credential_issuer`.
   That role owns every governed door **including the legacy ones 0151 shut**, so a
   login-capable member could `set role` to it and call `revoke_device_credential_v1` —
   the RC-021 bypass class, reintroduced by the hardening migration. The section-3 census
   did not catch it because it asks whether runtime roles hold EXECUTE, never whether
   someone can become the owner.
   It had also been propping up a test: the integration suite's direct
   `update … set state='revoked'` only worked because of the leak. It now revokes through
   the production service's governed door with a real four-eyes approval.

2. **The worker was granted two revocation readers it does not need.**
   Decision §2.5 gives the worker detection and escalation but no revocation path.
   Removed; the census now asserts both the two it must reach and the two it must not.

## Known limitations — NOT claimed, NOT implied

- **§4 Hub-side persistence is NOT implemented.** Atomic apply, last-known-good retention
  and reboot survival in the Hub database (following `recordDownloadedSnapshot` →
  `verifySnapshot` → `activateSnapshot`/`rollbackSnapshot`) do not exist. The "reboot" test
  is a JSON round-trip of a snapshot in memory, not persistence.
- **Offline containment is not in force.** There is still no configuration signer (BLK-005
  item 8, review condition C4), so the builder emits `signatureValid: false` and
  `evaluateRevocationSnapshot` REFUSES it. Snapshots are BUILT AND REFUSED.
- **`enforcedRevocationUnion` has no production caller** — it is proven by unit test only.
  That is the same shape of gap as RV-GW-001 and is stated rather than glossed.
- **§6 concurrency cases NOT written**: real clock expiry while lock-parked, incident-scope
  mutation during execution, identical-vs-conflicting idempotency replay. Note the database
  already returns `KLUY-EMERGENCY-CONFLICTING-REPLAY` for the third, but no separate-connection
  test exercises it.
- **§7 full production-composition lifecycle NOT run.** The 16-test live suite covers
  issuance → online verify → governed revoke → deny, not the whole enrollment-to-destruction chain.
- **§5 lapse worker has no DB-backed worker-composition test.** Handler dispositions and
  retry classification are unit-tested; `createEmergencyLapseWorker` is not exercised against
  a live durable-job queue.
- **Emergency SUCCESS path is not proven through the service.** The live suite proves a
  governed refusal for an unauthorized human; a granted-permission success needs the
  permission + re-auth evidence fixture and was not built.

## Environment conditions (§8) — disclosed, not hidden

- **Node v24.14.1, NOT the pinned 22.23.0.** `.nvmrc` says 22.23.0 and `engines` says
  `>=22.12.0 <23`, so the installed runtime **violates the declared range**. No Node 22 is
  installed and no version manager (nvm/fnm/volta/asdf) is present. Every step was run
  individually with `npm_config_engine_strict=false`; **no config file was changed and the pin
  was not touched.** Pinned-toolchain compliance is **NOT** claimed.
- `db:validate` exit 0 with **3** `schemas-in-dictionary` false positives — groups 0127, 0131,
  0152, all pre-existing. Group 0155 PASSES. The register says "two"; the third arrived with
  0152 before this session, so that figure was already stale.
- `docs:verify` aggregate reports 8/8 FAIL because it spawns nested `pnpm`, absent from PATH.
  Individually 7 of 8 pass; `check-classified` fails on 12 imported source documents.
  **Confirmed pre-existing** by stashing this session's work and re-running at `f1c617d`.
  The register's "docs:verify 8/8 PASS" is stale.

## Current implementation status (evidence register delta)

| Item                                   | Before                        | After                                                    |
| -------------------------------------- | ----------------------------- | -------------------------------------------------------- |
| RevocationGateway production wiring    | RV-GW-001 OPEN (uncalled)     | **CLOSED** — called from `main.ts` via `resolveDeviceRevocationService`, proven live |
| Online revocation lookup wiring        | RV-GW-001 OPEN                | **CLOSED** — `CERT_REVOKED` through the production verifier |
| TS lapse worker                        | RV-GW-002 OPEN                | **PARTIAL** — handler + composition exist; no live queue test |
| Offline Hub snapshot                   | RV-GW-003 OPEN                | **PARTIAL** — producer, scope binding and no-un-revoke done; Hub persistence and signing NOT done |
| WS-11-T003 Step 4                      | IMPLEMENTED-IN-DEV WITH RECORDED ENVIRONMENT CONDITION | **UNCHANGED — not promoted** |

## Recommended next task

1. Hub migration 0027 + Hub module for revocation-snapshot persistence, following the
   configuration-snapshot pattern; wire `enforcedRevocationUnion` into that applier.
2. The three §6 concurrency scenarios on genuinely separate connections.
3. §7 lifecycle through the production composition.
4. A granted-permission emergency success + post-approval + lapse chain through the service.
5. Install Node 22.23.0 and re-run the canonical suite before any pinned-toolchain claim.
