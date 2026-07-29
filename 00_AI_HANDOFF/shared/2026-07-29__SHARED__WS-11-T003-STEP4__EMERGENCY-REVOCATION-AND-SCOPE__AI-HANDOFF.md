# Emergency credential revocation, scope resolution and the one-way rule — AI Handoff

| Field           | Value                                                               |
| --------------- | ------------------------------------------------------------------- |
| Task ID         | WS-11-T003 Step 4 — migration group 0138                            |
| Date / timezone | 2026-07-29 · Asia/Phnom_Penh                                        |
| Repository root | `C:\dev\HET-KITLUY-PROJECT`                                         |
| Starting SHA    | `8b9ecb7`                                                           |
| Committed       | No. Everything is left in the working tree, as the task instructed. |

## Sources inspected

- `docs/decisions/kitluy-device-credential-revocation-and-scope-owner-decision-v1.0.0.md`
  (OWNER-APPROVED, KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001).
- `supabase/migrations/20260729160136_0136_credential_revocation_and_recovery.sql`.
- `supabase/migrations/20260729170137_0137_device_key_destruction_workflow.sql`.
- `supabase/tests/assertions.sql` sections 7, 32, 39a/39b, 40a/40b.

## Authority applied

Owner decision KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2 and §3,
implementation obligations 2–6. The decision closes
`[REQUIRED: device_credential_revocation_approval_policy]` and
`[REQUIRED: device_revocation_scope_policy]`.

## Scope

**In:** migration group `0138`, additive only; permanent assertions section 41.

**Out, and absent rather than stubbed:** any edit to groups 0125–0137; a fix for
the group-0136 defects found on the way (recorded as RC-014); a production
scheduler for the post-approval sweep; independent review (decision §4 item 7).

## Files created / changed

- **Created** `supabase/migrations/20260729180138_0138_emergency_revocation_and_scope.sql`
- **Changed** `supabase/tests/assertions.sql` — new section 41 (41a/41b/41c) appended;
  no existing assertion was weakened, removed or renumbered.
- **Changed** `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`
  — RC-013 and RC-014 added.

## What group 0138 contains

| Obligation | Implementation                                                                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §4.2       | `credential_revocation_policy` gains `emergency_eligible_reasons` (the five §2.2 reasons), `approve_before_execute_reasons` (the four §2.1 reasons), `post_approval_window_hours = 4`, and CHECKs that the two sets are DISJOINT and TOTAL over the enum. |
| §4.3       | `device_credential_emergency_revocations` — declaring authority + role enum, re-authentication evidence, mandatory reason, NOT NULL incident reference, frozen post-approval deadline, and the post-approval decision or its absence.                     |
| §2.2/§2.3  | `revoke_device_credential_emergency_v1` executes immediately with no prior approval, refusing an ineligible reason, a missing incident reference, a missing re-authentication and a missing reason before it touches anything.                            |
| §2.4       | `record_emergency_revocation_post_approval_v1` and `lapse_emergency_revocation_post_approvals_v1`. Neither contains a statement writing `device_credentials`; `enforce_revocation_is_one_way` refuses the reversal independently of both.                 |
| §4.4/§3    | `resolve_revocation_scope_v1` — one branch per row of the §3 table, derived from the reason, never from the caller.                                                                                                                                       |
| §4.5/§3.1  | `revocation_recorded_scopes` refuses an unrestricted wildcard, an empty set, a wildcard token and a self-approved blast radius, by CHECK.                                                                                                                 |
| §2.5       | `machine_initiated_revocation_permitted` cannot be true, and `kitluy_worker_service` can execute no function matching `%revoke%`/`%revocation%`.                                                                                                          |

## Commands executed (with actual results)

| Command                                                                                         | Result                                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm db:reset` → `db:seed` → `db:test`                                                         | exit 0 — **187 PASS notices** (baseline before this work: 184)                        |
| `pnpm test:rls`                                                                                 | exit 0 — **104 PASS notices**                                                         |
| `pnpm migrations:validate`                                                                      | passed (37 files)                                                                     |
| `pnpm secret:scan`                                                                              | passed (1158 tracked files)                                                           |
| `pnpm clock:check`                                                                              | passed                                                                                |
| `pnpm lint`                                                                                     | exit 0 (2 pre-existing warnings)                                                      |
| `pnpm typecheck` / `test` / `test:contract` / `test:offline` / `build` / `contracts:validate`   | all exit 0                                                                            |
| `pnpm docs:check` / `docs:hash` / `docs:authority-check` / `docs:registry-check` / `docs:links` | all exit 0                                                                            |
| `pnpm format:check`                                                                             | **exit 1** — `R&D_HSA_AI_Agent_MVP.md` only. Pre-existing; not touched by this work.  |
| `pnpm db:validate`                                                                              | **exit 1** — 2 pre-existing failures in groups 0127 and 0131. 0138 is not implicated. |
| `pnpm verify`                                                                                   | **exit 1 — every step reported ERR_PNPM_UNSUPPORTED_ENGINE.** See deviation below.    |

### Environment deviation (must be reported, not hidden)

Only Node **v24.15.0** is installed; `package.json` pins `>=22.12.0 <23`.
`scripts/verification/verify.mjs` spawns `pnpm` without an engine override, so
every one of its twelve steps failed on the engine guard rather than on the
code. `pnpm verify` was therefore run **step by step** with
`npm_config_engine_strict=false`, and the table above reports those actual
results. `pnpm verify` as a single command has **not** passed in this session.

## Conflicts discovered

- **RC-013** — decision §3 row 7 presumes an approval request can enumerate a
  broader scope. `kitluy_auth.approval_requests` carries `payload_hash`, not a
  payload, and the credential governor holds no access to that schema.
  Materialised as `kitluy_devices.revocation_recorded_scopes` citing the
  approving request id. Owner confirmation requested.
- **RC-014** — group 0136's `revoke_device_credential_v1` cannot complete a
  revocation (missing `revoked_at`, and a cross-schema read it lacks privilege
  for). Recorded, **not fixed** — outside this session's scope.

An earlier draft of 0138 granted the credential governor a narrow read on
`kitluy_auth.approval_requests` with an RLS policy. Assertion section 7's policy
census (`58 SELECT policies`) refused it, correctly: that is a boundary change
needing its own decision. The grant and the policy were removed rather than the
census being edited.

## Security findings

- A revoked credential can no longer be returned to service by ANY caller,
  including `kitluy_credential_issuer` itself (`enforce_revocation_is_one_way`).
  This is new and applies to every revocation, not only emergency ones.
- An emergency post-approval deadline can be brought forward but never extended.
  Bringing it forward can only cause an earlier escalation; extending it is the
  attack the asymmetry exists to refuse. Decision §2.3's 4 hours is what the
  policy issues and is asserted verbatim.

## Known limitations

- `lapse_emergency_revocation_post_approvals_v1` has **no scheduler**. Nothing
  calls it automatically; a PENDING post-approval stays PENDING until something
  invokes the sweep. Registering it as a durable job kind (group 0135) is the
  obvious next step and was deliberately not done here.
- Decision §4 item 7 (independent review before promotion) has **not** happened.
  Nothing in this group may be promoted past `IMPLEMENTED-IN-DEV component`
  without it.

## Current implementation status (evidence register delta)

None claimed. The evidence register was not advanced: this session produced
migration and test evidence only, and decision §5 plus KLD-EVIDENCE-001 both
require independent review before a status moves.

## Recommended next task

1. A scoped corrective migration for RC-014, with a hostile test that actually
   calls the approve-before-execute path end to end.
2. Owner confirmation of the RC-013 materialisation.
3. Register the post-approval sweep as a durable job kind.
