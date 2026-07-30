# WS-11-T003 Step 4 — Phase C: RC-022 census + real RevocationGateway

| Field           | Value                                            |
| --------------- | ------------------------------------------------ |
| Task ID         | WS-11-T003 Step 4 — Phase C (0153 + gateway)     |
| Date / timezone | 2026-07-30 · Asia/Phnom_Penh                     |
| Repository root | C:/Users/Hello-Evo-PC/Desktop/HET-KITLUY-PROJECT |
| Start SHA       | a1284f8 (Phase B handoff)                        |
| Status          | Phase C GREEN — NOT Step-4 complete              |

## What was completed

1. **Migration 0153** — `emergency_approval_still_approved_v1` bridge; governed
   emergency refuses `KLUY-EMERGENCY-SCOPE-APPROVAL-DEAD` when the cited
   approval is no longer APPROVED.
2. **SECTION 48** — post-suite spendability census: REJECT leftover APPROVED
   `device_credential_revocation` approvals, lapse unanswered emergencies,
   revoke ACTIVE reauth residue; assert zero reusable authority.
3. **RC-022 CLOSED** in the decision/reconciliation register.
4. **`createPgRevocationGateway`** — production adapter calling
   `revoke_device_credential_bound_v1` (0147 runtime door), snake_case jsonb
   mapping; integration test proves issuance_service role + permanent denial
   on the legacy unscoped function.

## Intentionally NOT done

- Phase D: true-concurrency / full lifecycle containment
- Phase E: independent review / Step 4 promotion
- T004–T008; push

## Commands (actual)

```text
db:reset → PASS (through 0153)
db:seed  → PASS
db:test  → PASS (incl. PASS ws11-rc022-spendability-census)
test:rls → PASS
vitest run test/pg-revocation-gateway.integration.test.ts → 2 PASS
```

## Recommended next

Phase D — concurrency / lifecycle / containment verification.
