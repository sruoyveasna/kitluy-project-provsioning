# WS-11-T003 Step 4 — Phase A: enforce governed emergency revocation

| Field           | Value                                            |
| --------------- | ------------------------------------------------ |
| Task ID         | WS-11-T003 Step 4 — Phase A (migration 0151)     |
| Date / timezone | 2026-07-30 · Asia/Phnom_Penh                     |
| Repository root | C:/Users/Hello-Evo-PC/Desktop/HET-KITLUY-PROJECT |
| Start SHA       | acfce308264db50dad8416fb5b79fb90f8f8809d         |
| Status          | Phase A GREEN — NOT Step-4 complete              |

## Sources inspected

- `PROJECT_HOME.md`, `AGENTS.md`, `CLAUDE.md`, `00_AI_HANDOFF/000_*`
- RC-019..RC-026 in the decision/reconciliation register
- Migrations 0138, 0147–0150; `supabase/tests/assertions.sql` sections 41a–c, 47
- Live grant census and RC-021 exploit reproduction (rolled back)

## Authority applied

- KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.2/§2.3/§2.4
- KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1
- KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001
- RC-021 / RC-023 closure criteria from the continuation prompt Phase A/B

## What was completed (Phase A)

1. **Reproduced RC-021** as `kitluy_issuance_service` with asserted CISO + reauth /
   DEVICE_STOLEN → `REVOKED_IMMEDIATELY` (2 credentials); rolled back.
2. **Re-homed seven legacy call sites** in `assertions.sql` (five refusals in 41b,
   two positives in 41c) onto `revoke_device_credential_emergency_governed_v1`
   with authenticated human session, scoped permission, action-bound
   re-authentication evidence, real incident reference, database-derived scope.
3. **Additive migration 0151** revoked EXECUTE on
   `revoke_device_credential_emergency_v1` from PUBLIC, anon, authenticated,
   service_role, kitluy_issuance_service, kitluy_worker_service,
   kitluy_job_governor, kitluy_activation_governor,
   kitluy_credential_approval_reader, and postgres. Governor-only retention.
4. **Section 47 control 13** proves the exploit fails with permission denied
   before mutation; grant census matches 0151.
5. **RC-021 CLOSED** (legacy path impossible; governed path mandatory).
6. **RC-023 CLOSED** (keys + session-bound evaluation under authenticated human).

## Intentionally NOT done (Phase B+)

- Governed post-approval / lapse against
  `device_emergency_revocation_authorizations` (41c deferred REFUSE/LAPSE)
- Recorded-set spend for PROVIDER_COMPROMISE / SECURITY_INCIDENT
- Tenant / Digital Store / Location binding bridges
- RC-022 spendability census across all sections
- Real `RevocationGateway` production wiring
- True-concurrency / full lifecycle / independent review / Step 4 promotion

## Files created / changed

- `supabase/migrations/20260730160151_0151_enforce_governed_emergency_revocation.sql` (new)
- `supabase/tests/assertions.sql` (41b, 41c, 47 re-home + control 13)
- `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md` (RC-021, RC-023)
- this handoff + `00_AI_HANDOFF/000_INDEX.md`

## Commands executed (actual)

| Command                                                         | Result                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm db:reset` (via `npx pnpm@9.15.9`, engine-strict override) | exit 0; migrations through **0151**                                    |
| `pnpm db:seed`                                                  | exit 0                                                                 |
| `pnpm db:test`                                                  | exit 0; **193 PASS**                                                   |
| `pnpm test:rls`                                                 | exit 0; **104 PASS**                                                   |
| Live exploit after 0151                                         | `permission denied for function revoke_device_credential_emergency_v1` |

## Environment conditions (recorded, not hidden)

- Node **v24.14.1** vs pinned ACTIVE-BASELINE **22.23.0** (not installed)
- `pnpm` invoked via `npx pnpm@9.15.9` with `npm_config_engine_strict=false`
- Stopped conflicting `hsa_eco` Supabase stack to free ports 54321/54322/54323
- Push URL remains `disabled://push-requires-owner-approval`

## Current Step 4 status

**BLOCKED** pending Phase B–E. Phase A gate is green.

## Recommended next task

Phase B — Complete emergency governance: tenancy binding bridges, all five
emergency reasons including recorded-set spend, governed distinct-human
post-approval + fixed four-hour lapse worker, then Phase C gateway/census.
