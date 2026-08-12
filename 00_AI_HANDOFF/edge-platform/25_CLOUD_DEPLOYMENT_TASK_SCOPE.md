# Task scope — deploy the canonical chain to the hosted development project

> ## ⚠ CORRECTION (2026-08-10) — read this before anything below
>
> Statements in this document about "the cloud" being EMPTY, PG17-BLOCKED, or
> about `gkfcxxtryqmjnhujlkdr` / `het-kitluy-dev` being the development target
> are **WRONG** and are superseded by **KLD-2026-08-10-CLOUD-TARGET-001**.
>
> The canonical cloud development project is **`gjgbnkhuwlwhngbtrgts`
> (kitluy-project-pos)**, it is at **87/87 migrations**, and it is at full
> schema parity with local. The **PG17 blocker is CLOSED**.
>
> The error came from enumerating Supabase projects through the MCP connector
> only; that connector is authenticated to a different account than the one
> owning the real project. Everything else in this document stands.

**Date:** 2026-08-10 · **Status: SCOPE ONLY — nothing executed, nothing deployed.**
**Target:** `het-kitluy-dev` / `gkfcxxtryqmjnhujlkdr` (ap-southeast-1, PG 17.6)

---

## 1. Why this is a task at all

Nothing connects to the hosted project today, on either side:

    repo linked to a project ........ NO (no supabase/.temp/project-ref)
    config.toml ..................... project_id = "kitluy-local", major_version 15
    .env / .env.local ............... none exist
    SUPABASE_URL, MANAGEMENT_API_DATABASE_URL, VITE_* ... all unset

    het-kitluy-dev: kitluy schemas 0 · tables 0 · migration tracking absent · auth.users 0

Every proof so far ran against local Docker PostgreSQL 15 on `:54402`.

## 2. The finding that changes the estimate — the PG17 blocker looks CLOSED

Handoff 14 (2026-08-07) recorded the chain as unable to apply to PostgreSQL 16+:
`0140` needs `SET ROLE kitluy_job_governor`, `0151` asserts no non-superuser
holds that membership, and PG16 auto-grants exactly that membership.

**That was subsequently fixed in the repository.** Migration `0151` now carries
an explicit carve-out:

> PG16+ (KLREC-2026-08-07-PG16-CREATEROLE-001): ignore the un-removable
> membership PostgreSQL 16 auto-grants to the role that created this one. A
> borrow this chain took itself has grantor = member and is still a finding.

And the local `repo17` stack proves it end to end:

|                              | local repo17 | hosted het-kitluy-dev  |
| ---------------------------- | ------------ | ---------------------- |
| PostgreSQL                   | **17.6**     | 17.6                   |
| `postgres` is superuser      | **false**    | false (per handoff 14) |
| `postgres` has CREATEROLE    | true         | true                   |
| canonical migrations applied | **86 of 86** | 0                      |

repo17 matches the hosted privilege profile exactly and applies the whole chain,
including `0140` and `0151`. **The central risk of this task is therefore much
lower than previously reported.** It is not zero — the hosted environment adds
Supabase-managed roles and extensions that a local container does not — but the
blocking defect is fixed, not merely worked around.

> The earlier report of "PG17 blocked" is superseded. Correct classification of
> the hosted project is **HOSTED PROJECT EMPTY — never deployed**.

## 3. The real obstacle: the tooling is deliberately local-only

`scripts/database/db-exec.mjs` refuses any non-local target:

    db:apply / db:reset / db:seed  ->  assertLocalTarget()
    "REFUSED: SUPABASE_DB_URL points at a non-local database."

This is not an oversight. It implements **KL-INF-P1-037 (OWNER-LOCKED)**:
migrations are never auto-applied — not from CI, not from app startup, not from
an AI session. The guard does not distinguish "hosted development" from
"production"; it refuses everything remote.

**So this task cannot start without an owner decision.** See §7.

## 4. Phases

### Phase 0 — owner decisions (blocking, ~30 min of your time)

Nothing below may start until §7 is answered.

### Phase 1 — dry run against a disposable hosted project

Do **not** make `het-kitluy-dev` the first hosted target. Create a scratch
project, apply all 87 migrations, record every divergence from local, then
delete it. Cost is a few dollars; the alternative is discovering a
half-applied chain in the project you intend to keep.

Deliverable: a divergence list (Supabase-managed roles, extension availability,
`postgres` privileges, anything the chain assumes about a fresh database).

### Phase 2 — apply to `het-kitluy-dev`

- 87 migrations, in order, via the approved remote path from §7.
- Verify: 87 tracked, 15 kitluy schemas, ~188 tables, RLS policy count matches
  local, `pnpm db:validate` equivalent green.
- **Snapshot/branch first** so a bad apply is recoverable.

### Phase 3 — seed development fixtures

`supabase/seed/dev-fixtures.sql` exists but is local-guarded and asserts
`kitluy.environment = 'local'`. A hosted development run needs an approved
environment value — a small, explicit change to the seed's guard, not a bypass.

Must produce: the tenant/store/location scope, hardware profiles, an Admin
account with `fleet.read` + `fleet.device_provisioning_code.issue`. Today
`auth.users = 0`, so **nobody can sign in to the Admin portal.**

### Phase 4 — wire the applications

Create the real `.env` (never committed):
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `MANAGEMENT_API_DATABASE_URL`,
`MANAGEMENT_API_AUTH_URL`, `MANAGEMENT_API_ALLOWED_ORIGINS`,
`VITE_KITLUY_SUPABASE_URL`, `VITE_KITLUY_MANAGEMENT_API_URL`.

Then prove one real Admin sign-in reaching `GET /management/v1/devices` against
hosted data.

### Phase 5 — re-run the edge proof against the cloud

Re-run the Hub chain (enrol → QA → claim → observation → trusted time) against
hosted, so the M1 evidence is cloud-backed rather than local-only.

## 5. Explicitly out of scope

Production or staging projects · BLK-005 signing · the certificate activation
gate · Terminal provisioning · Management API POST route, Admin UI, Hub CLI ·
the golden-image snakeoil key · the 47 prettier / 4 doc-link items.

## 6. Risks

| Risk                                                                 | Severity | Mitigation                                                                         |
| -------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| Hosted env diverges from local container (managed roles, extensions) | medium   | Phase 1 dry run on a disposable project                                            |
| Half-applied chain leaves the project unusable                       | medium   | snapshot/branch before Phase 2; dry run first                                      |
| Loosening the local-only guard becomes a precedent for production    | **high** | environment allowlist naming the dev ref only; never a generic "allow remote" flag |
| Secrets landing in git                                               | high     | `.env` only; `pnpm secret:scan` before finishing                                   |
| Cost                                                                 | low      | one extra scratch project, deleted after Phase 1                                   |

## 7. Owner decisions required before starting

1. **May migrations be applied to a hosted _development_ project by this
   session, given KL-INF-P1-037?** If yes, by which route — `supabase db push`
   run by you, or a narrow allowlist in `db-exec.mjs` naming
   `gkfcxxtryqmjnhujlkdr` only?
2. **Approve a disposable scratch project for the Phase 1 dry run** (a few
   dollars, deleted afterwards)?
3. **Who creates the Admin account and holds the credentials?** I should not
   mint or hold them.
4. **Seed guard:** extend `dev-fixtures.sql` to accept an approved hosted
   `development` environment, or keep it local-only and seed the cloud another
   way?

## 8. Estimate

Phase 1 half a day · Phase 2 1–2 hours · Phase 3 2–4 hours (mostly the seed
guard and Admin account) · Phase 4 1–2 hours · Phase 5 1–2 hours.
Roughly **1.5–2 working days**, assuming Phase 1 finds no structural divergence.
