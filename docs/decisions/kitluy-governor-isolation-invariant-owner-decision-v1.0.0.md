# KitLuy governor isolation invariant — OWNER DECISION (DEC-5)

| Field       | Value                                                        |
| ----------- | ------------------------------------------------------------ |
| Decision ID | `DEC-5` / `KLD-2026-08-11-GOVERNOR-ISOLATION-001`             |
| Status      | **OWNER-CONFIRMED — STRONG INVARIANT LOCKED**                 |
| Decided     | 2026-08-11                                                    |
| Scope       | all environments; production certification gated              |
| Supersedes  | the narrower "immediate capability only" reading recorded in `31_DEC4_CLOUD_ROLE_GRAPH_EVIDENCE.md` §1 |

## 1. The invariant

> An unauthorized deployment/login role must neither have immediate access to a
> protected governor role nor possess administrative authority that lets it
> grant itself such access.

A role satisfies KitLuy governor isolation only when **both** properties are
absent:

| Property | Name | Test |
| -------- | ---- | ---- |
| A | `IMMEDIATE_GOVERNOR_ACCESS` | `pg_has_role(role, governor, 'SET')` or `… 'USAGE'` |
| B | `ADMINISTRATIVE_SELF_ESCALATION` | `ADMIN OPTION` held on a governor membership |

`MEMBER` is **not** a valid test for either. Since PostgreSQL 16 a membership
row with `SET FALSE / INHERIT FALSE` confers no capability, so `MEMBER` answers
neither question — proven on the canonical cloud, where `MEMBER = true` while
`SET ROLE` is refused.

## 2. Current hosted Supabase role shape

Verified read-only on `kitluy-project-pos` (`gjgbnkhuwlwhngbtrgts`), 2026-08-11.
Identical for every protected governor:

    kitluy_credential_issuer  <-member- postgres
      grantor        = supabase_admin       (the bootstrap superuser)
      admin_option   = true
      inherit_option = false
      set_option     = false

    postgres: login=true super=false createrole=true bypassrls=true

## 3. Proof of self-escalation

Executed on a **disposable** PG17.6.1.155 cluster carrying that exact shape —
never against cloud. Connected as `postgres`:

    1. SET ROLE kitluy_credential_issuer          -> refused (permission denied)
    2. GRANT kitluy_credential_issuer TO postgres
         WITH SET TRUE                            -> SUCCEEDED
    3. SET ROLE kitluy_credential_issuer          -> SUCCEEDED

    after: a second row appears —
      grantor = postgres, admin = false, inherit = true, set = true
      SET = true, USAGE = true

## 4. Classification

    PROPERTY A  IMMEDIATE_GOVERNOR_ACCESS ........ PASS  (absent)
    PROPERTY B  ADMINISTRATIVE_SELF_ESCALATION ... FAIL  (present)

    KITLUY GOVERNOR ISOLATION ..................... NOT FULLY SATISFIED

## 5. Why application code cannot repair it

The membership PostgreSQL 16+ auto-grants to a `CREATEROLE` creator is recorded
with the **bootstrap superuser** as grantor. A migration running as `postgres`
cannot revoke a grant it did not issue, and cannot re-issue its own membership
without `ADMIN OPTION` — which is the very thing that would have to be removed.

Removing it requires a superuser (`supabase_admin`) to re-issue every governor
grant with `ADMIN FALSE`. On managed Supabase that role is not exposed to the
project owner through the pooler connection, so no migration, function, policy
or deployment script in this repository can reach it.

Classification: **MANAGED-PLATFORM SECURITY LIMITATION.** It is not permission
to weaken the invariant, and the invariant is not restated to match what the
platform happens to allow.

## 6. Compensating controls

1. **The escalation is not silent.** It requires an explicit `GRANT` and leaves
   a distinguishable second membership row (`grantor = <the login role itself>`,
   `set = true`). It is an auditable privileged action, not an ambient
   capability.
2. **Detection is in the security suite.** `assertions.sql` control 2 reports
   both properties independently on every run, and names each non-superuser
   holding `ADMIN OPTION`:

       NOTICE: control 2 ADMINISTRATIVE_SELF_ESCALATION: postgres holds ADMIN
               OPTION on the credential governor and can grant itself SET
               (DEC-5, open)

   Property A remains a **hard** finding. Property B is surfaced by name rather
   than failing the suite, because no change in this repository can clear it and
   a permanently red suite trains people to ignore it — the condition is tracked
   here instead.
3. **Role-graph change is detectable.** The membership census in the assertion
   suite distinguishes the un-removable auto-grant (`grantor <> member`) from a
   deliberate self-borrow (`grantor = member`), so a self-elevation performed by
   the deployment login is reported rather than absorbed.

## 7. Disposition

    KNOWN RESIDUAL PLATFORM RISK — ACCEPTED FOR DEVELOPMENT
    NOT ACCEPTED AS PROVEN PRODUCTION ISOLATION

This does not block Pi Terminal development.

Before production security certification, one of the following must hold:

- Supabase-supported removal of `ADMIN OPTION` from the deployment login's
  governor memberships; **or**
- an alternative privileged-role architecture in which the migration login never
  creates the protected governors; **or**
- another owner-approved isolation mechanism.

No unsupported workaround may be invented to close this.

## 8. Evidence

- `00_AI_HANDOFF/edge-platform/31_DEC4_CLOUD_ROLE_GRAPH_EVIDENCE.md` — cloud role graph
- `00_AI_HANDOFF/edge-platform/32_DEC4_SELF_ESCALATION_PROBE_AND_0189.md` — probe and reconciliation
- `supabase/tests/assertions.sql` — control 2, two-property model
