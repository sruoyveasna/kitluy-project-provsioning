# Canonical cloud Supabase deployment

**Date:** 2026-08-07
**Status:** **NOT DEPLOYED — BLOCKED.** The project exists and is empty; the
canonical chain cannot apply to it as written.

---

## 1. The cloud project

| Field        | Value                                      |
| ------------ | ------------------------------------------ |
| Name         | `het-kitluy-dev`                           |
| Project ref  | `gkfcxxtryqmjnhujlkdr`                     |
| Organisation | `cfgrfiqqobgdhudzonue`                     |
| Region       | `ap-southeast-1`                           |
| PostgreSQL   | **17.6**                                   |
| Cost         | $10/month, owner-confirmed before creation |
| Created      | 2026-08-07 by this session, owner-approved |

Nothing secret appears here: a project ref is a public identifier. No access
token, database password, service-role key or publishable key was printed,
written to a file or committed.

### 1.1 It is genuinely empty — verified, not assumed

    kitluy schemas ............ 0
    kitluy roles .............. 0
    public tables ............. 0
    supabase_migrations schema. absent
    schemas present ........... auth, extensions, graphql, graphql_public,
                                public, realtime, storage, vault

Only Supabase defaults. There is no conflicting migration history, so the
mission's §5 "if it is not empty, STOP" condition does **not** apply. The
blocker is a different one.

### 1.2 Projects deliberately NOT used

`kitluy-suite-monorepo-dev` (donor lineage, 1,518 live rows) and `hsa-eco-dev`
(a different ecosystem) were not touched, not linked and not queried for
anything beyond the read-only lineage comparison already recorded in
`13_FINAL_REPORT.md`.

---

## 2. Local reset-from-zero gate — PASSED (PostgreSQL 15)

Run in an isolated workdir on ports 54341–54344. The `hsa_eco` stack still
holds KitLuy's declared ports 54321–54323 and was **not** stopped; no unrelated
project was modified to make this run.

| Step                           | Result       |
| ------------------------------ | ------------ |
| `supabase db reset` from empty | **exit 0**   |
| Migrations applied             | **86 of 86** |
| Seed                           | **exit 0**   |
| Structural assertions          | **exit 0**   |
| RLS suite                      | **exit 0**   |

Schema produced:

    kitluy schemas ....... 15      tables ............... 183
    views ................ 2       functions ............ 255
    triggers ............. 160     enums ................ 29
    foreign keys ......... 466     applied ledger ....... 86
    RLS-enabled tables ... 181 / 183

The two tables without RLS are `kitluy_ops.migration_journal` and
`kitluy_ops.test_clock_policy` — internal operational tables, not business or
device data. `kitluy_devices` is **64 / 64**.

---

## 3. THE BLOCKER — the chain does not apply to PostgreSQL 17

The cloud project runs **PostgreSQL 17.6**. The canonical chain has only ever
been validated on **PostgreSQL 15** (`supabase/config.toml` declares
`major_version = 15`).

Running the chain against PostgreSQL 17 **fails at migration 51 of 86**:

    Applying migration 20260730160151_0151_enforce_governed_emergency_revocation.sql...
    ERROR: ASSERT FAIL 0151: 1 finding(s):
           a non-superuser still holds membership of the credential governor

### 3.1 Root cause — reproduced in isolation

PostgreSQL 16 changed `CREATEROLE` semantics: a non-superuser role holding
`CREATEROLE` now **automatically becomes a member** of every role it creates.
On PostgreSQL 15 it did not.

Reproduced directly, same script on both majors:

    PostgreSQL 15 → members of kitluy_credential_issuer: NONE
    PostgreSQL 17 → members of kitluy_credential_issuer: creator (super=false)

This is **not** a superuser difference between environments. `postgres` is a
non-superuser with `CREATEROLE` in _both_:

|                           | local validation stack | cloud `het-kitluy-dev` |
| ------------------------- | ---------------------- | ---------------------- |
| PostgreSQL                | 15                     | 17.6                   |
| `postgres` is superuser   | **false**              | **false**              |
| `postgres` has CREATEROLE | true                   | true                   |

The only variable is the major version.

### 3.2 Why this is not a one-line fix

The two requirements become **mutually unsatisfiable** on PostgreSQL 16+:

- migration `0140` needs `postgres` to `SET ROLE kitluy_job_governor`, which on
  PG16+ requires recorded membership;
- migration `0151` asserts that **no** non-superuser holds membership of the
  credential governor.

Confirmed by probe: applying the chain to PostgreSQL 17 with the auto-granted
membership swept before each assertion moves the failure earlier, to migration
40 of 86:

    ERROR: ASSERT FAIL 0140: control 10: the execute probe for
           kitluy_job_governor did not complete:
           permission denied to set role "kitluy_job_governor"

On PostgreSQL 15, `CREATEROLE` carried implicit authority to act as roles it
created without recorded membership, so both assertions held at once.
PostgreSQL 16 removed that implicit authority and replaced it with explicit
auto-granted membership — which satisfies `0140` and violates `0151`.

The probe ran against a **scratch copy** of the migrations. The repository's
migrations were not modified, and the probe preamble exists nowhere in the
canonical chain.

### 3.3 Why this was not fixed here

Correcting it requires editing migrations that are already applied in
development environments — a migration-history rewrite. `CLAUDE.md` hard rule 3
and the workspace Git-safety rules put that outside an agent's authority, and
mission §5 explicitly forbids changing applied migration versions. Recorded
rather than silently resolved, per `CLAUDE.md` hard rule 8.

Supabase provisions PostgreSQL 17 for new projects; there is no
`create_project` option to select PostgreSQL 15, so "use PG15 in the cloud" is
not available either.

### 3.4 What the owner needs to decide

1. **Authorise a governed remediation task** to make the chain PG16+-compatible.
   The likely shape is additive: after each governed role is created, explicitly
   `REVOKE` the auto-granted membership, and relax `0151`'s assertion to permit
   exactly the creating role — preserving the security property (no _unexpected_
   member) while accommodating PG16+ mechanics.
2. **Decide whether that is a forward migration or an in-place correction.**
   A forward migration cannot work on its own: `0151` fails mid-chain, before
   any later migration could run. This most likely requires correcting the
   affected migrations, which is a history change and needs explicit approval.
3. **Decide whether `config.toml` should move to `major_version = 17`** so local
   validation matches the cloud target. Validating on 15 and deploying to 17 is
   how this defect stayed invisible.

---

## 4. Deployment workflow readiness

The repository's approved workflow is `supabase link` + `supabase db push`.
That requires a Supabase CLI access token, which is **not present**:

    ~/.supabase/access-token ....... absent
    SUPABASE_ACCESS_TOKEN .......... unset
    local-config/ .................. contains only e-menu-platform

Required from the owner, by exact name:

| Reference                                    | Purpose                                  |
| -------------------------------------------- | ---------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`                      | CLI auth for `supabase link` / `db push` |
| Database password for `gkfcxxtryqmjnhujlkdr` | `supabase link` prompt                   |

Both belong in `local-config/`, never in a Git-tracked file. **Neither is
needed until the PostgreSQL 17 blocker is resolved** — a token would not have
made this deployment succeed.

---

## 5. Migration identity — re-verified

`scripts/database/migration-manifest.mjs` (new) records version, filename,
SHA-256, group and schema domains for all 86 migrations, plus a single
`chainDigest` identifying the whole ordered chain:

    migrations .... 86
    range ......... 20260726180000 – 20260807040000
    chainDigest ... 64537569aaa3ab12f250324ece3761c96a43c045c45bcf020a99cff114da5325

No duplicate versions; ascending order asserted. `--check` mode fails on drift
and is wired into no gate yet — running it before any future deployment is the
cheap way to prove the remote received the canonical chain rather than assume it.

Output: `00_AI_HANDOFF/edge-platform/canonical-migration-manifest.json`.
No migration was renumbered, edited, or imported from the donor.
