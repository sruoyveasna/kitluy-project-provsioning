# WS-11-T003 Step 4 — Phase B: governed post-approval, lapse, recorded-set

| Field           | Value                                            |
| --------------- | ------------------------------------------------ |
| Task ID         | WS-11-T003 Step 4 — Phase B (migration 0152)     |
| Date / timezone | 2026-07-30 · Asia/Phnom_Penh                     |
| Repository root | C:/Users/Hello-Evo-PC/Desktop/HET-KITLUY-PROJECT |
| Start SHA       | 8badeaf160408d14976c685fcdbc2a3eacb6d05a         |
| Status          | Phase B GREEN — NOT Step-4 complete              |

## Sources inspected

- Phase A handoff; migrations 0138, 0141, 0150–0151; live grant/RLS census
- `device_emergency_revocation_authorizations` append-only / lifecycle constraints
- Ruling 1 `consume_revocation_scope_v1` signature and return shape

## Authority applied

- KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.2/§2.3/§2.4/§3
- KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1
- KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001

## What was completed (Phase B)

1. **Migration 0152** — post-approval verdicts table (append-only; separate from
   authorization lifecycle); `record_governed_emergency_post_approval_v1`
   (authenticated, distinct human, `fleet.device_credential.emergency_post_approve`,
   action-bound reauth); `lapse_governed_emergency_post_approvals_v1` (worker /
   issuance); `escalate_governed_emergency_v1`; tenancy bridge
   `emergency_device_tenancy_v1` (activation-governor owned).
2. **7-arg governed emergency** — optional `p_incident_scope_id` for
   PROVIDER_COMPROMISE / SECURITY_INCIDENT; digest + membership checks; Ruling 1
   consume with real revocation id; `emergency_authorization_id` on evidence;
   fleet reasons still use `authoritative_revocation_scope_v1`.
3. **Authorization immutability** — replace full append-only with deadline-fixed
   rule (bring forward only; never extend; never rewrite declaration facts);
   UPDATE grant for that narrow path; soften deadline CHECK so overdue cases
   can be observed.
4. **Assertions** — section 41c restores REFUSE / self-refuse / LAPSE / one-way;
   section 41d spends a recorded PROVIDER_COMPROMISE set; section 47 expects
   SCOPE-MISSING without `incident_scope_id` and the 7-arg signature.

## Intentionally NOT done (Phase C+)

- RC-022 spendability census across all assertion sections
- Real `RevocationGateway` production wiring
- True-concurrency / full lifecycle containment (Phase D)
- Independent review / Step 4 promotion (Phase E)
- T004–T008

## Files created / changed

- `supabase/migrations/20260730160152_0152_governed_emergency_post_approval.sql` (new)
- `supabase/tests/assertions.sql` (41c, 41d, 41b, 47)
- this handoff + `00_AI_HANDOFF/000_INDEX.md`

## Commands executed (actual)

```text
npx pnpm@9.15.9 db:reset   → PASS (through 0152)
npx pnpm@9.15.9 db:seed    → PASS
npx pnpm@9.15.9 db:test    → PASS (194 PASS notices; no ERROR)
npx pnpm@9.15.9 test:rls   → PASS (104 cases)
```

Node note: host Node v24.14.1 vs pinned 22.23.0; used `npm_config_engine_strict=false`
and `npx pnpm@9.15.9`.

## Known limitations

- Recorded-scope SELECT uses no row lock (issuer lacks UPDATE; FOR UPDATE denied).
  Atomic consume still raises on unique_violation. Phase D owns concurrency.
- Authorization `lifecycle_state` stays `EXECUTED_PENDING_POST_APPROVAL`; verdicts
  table carries APPROVED/REFUSED/LAPSED.
- KLRISK-DEVICE-003 remains open; no pgsodium; PG does not verify Ed25519.
- Step 4 overall remains BLOCKED until Phases C–E + independent review.

## Recommended next task

Phase C — RC-022 census + real RevocationGateway (do not promote Step 4; do not
start T004–T008; do not push).
