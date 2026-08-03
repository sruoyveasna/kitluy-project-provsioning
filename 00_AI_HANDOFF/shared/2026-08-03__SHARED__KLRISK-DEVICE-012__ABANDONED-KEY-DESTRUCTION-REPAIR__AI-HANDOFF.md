# KLRISK-DEVICE-012 — abandoned-key destruction repair (migration 0161)

| Field      | Value |
| ---------- | ----- |
| Task       | KLRISK-DEVICE-012 repair (recorded, bounded package) |
| Date       | 2026-08-03 · Asia/Phnom_Penh |
| Start SHA  | `2bc57a4` |
| Toolchain  | Node v22.23.0, pnpm 9.15.9 |
| Migrations | cloud **0161** added (additive); hub none |
| Push       | not pushed; URL `disabled://push-requires-owner-approval` |

## Defect (recorded 2026-08-01 as KLRISK-DEVICE-012)

Two compounding gaps made the 0137 `abandoned` destruction basis unreachable:

1. `device_generation_keys_abandon_chk` required `abandon_reason IS NULL` for
   every non-`abandoned` state; `confirm_key_destruction_v1` sets `destroyed`
   without clearing the reason, and `abandon_generation_key_v1` always sets
   one — so every abandoned key failed confirm with a check-constraint
   violation, after the provider may already have erased the private half.
2. A losing renewal's reservation stayed `pop_pending` for ever (the
   generation conflict raises and rolls back), so the eligibility's
   device-wide UNFINISHED_RENEWAL check blocked the basis anyway.

## Repair (migration 0161, additive)

1. Constraint amended to
   `state = 'destroyed' or (state = 'abandoned') = (abandon_reason is not null)`
   — the abandoned basis becomes reachable and the abandonment REASON survives
   destruction (option b; clearing the reason at confirm would have erased the
   audit). Reason is still required exactly for `abandoned` and forbidden on
   `active`/`superseded`.
2. `abandon_generation_key_v1` (create-or-replace, ownership preserved) now
   closes the dead attempt's reservation (`status = 'abandoned'`) atomically
   with the key abandonment; an already-terminal reservation is left alone.
   This is also what frees the open-reservation slot for a loser's retry.

`destructive-approved:KLRISK-DEVICE-012` marker: the DROP removes only the old
CHECK constraint inside the same transaction that adds the corrected one.

## Proof (fresh, from zero)

- `db:reset` 0000→0161 exit 0 (guard NOTICE confirms both halves).
- `db:test` 196 PASS · `test:rls` 104 PASS (fresh chain).
- `key-destruction.integration.test.ts` **13/13** including the new
  "destroys an ABANDONED key end-to-end, preserving the abandonment reason":
  reservation minted, key registered `generated`, abandoned through the
  governed function (reservation closed in the same call), eligibility on the
  abandoned basis, four-eyes request/approve, provider erasure, confirm
  DESTROYED, key row `destroyed` with `abandon_reason` preserved.
- device-identity package **779 passed / 2 skipped (baseline)**.
- registry **219/219** — lifecycle 30/30 (`executed=30/30`), census all zeros.
- `migrations:validate`, `db:validate`, typecheck: exit 0.

## Recorded, not changed

The comment/code mismatch on `abandon_generation_key_v1` ("refuses to abandon
an `active` key"): the body has no such check; the trigger's transition table
is what actually refuses active→abandoned and superseded→abandoned. Correcting
the comment or the behavior belongs to its own named package.

## Register updates

- `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`:
  KLRISK-DEVICE-012 → **CLOSED** with the 0161 evidence.
- `00_AI_HANDOFF/000_INDEX.md`: this handoff registered.
