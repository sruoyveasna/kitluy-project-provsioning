# Cloud Supabase plan — and the blocker that stops it

**Date:** 2026-08-07
**Status:** **BLOCKED — owner decision required.** No migration was applied to
any cloud project.

---

## 1. Local-first validation — PASSED

The mission's §8 gate ("do not deploy a migration to cloud that does not pass
local reset-from-zero validation") was executed in full and passed.

| Step                   | Command                          | Result                                      |
| ---------------------- | -------------------------------- | ------------------------------------------- |
| Fresh database         | `supabase db reset` from empty   | **exit 0**                                  |
| Migrations applied     | 86 of 86                         | **all applied**, no failures                |
| Seed                   | `supabase/seed/dev-fixtures.sql` | **exit 0**                                  |
| Structural assertions  | `supabase/tests/assertions.sql`  | **exit 0**, groups 0010–0180                |
| RLS suite              | `supabase/tests/rls-tests.sql`   | **exit 0**, all cases                       |
| Idempotency — re-apply | `supabase migration up`          | **exit 0**, "Local database is up to date"  |
| Idempotency — re-seed  | seed applied twice               | **exit 0**, `INSERT 0 0` on every statement |
| Type generation        | `supabase gen types typescript`  | **exit 0**, 5,394 lines                     |

**No migration failed. No fix was required.** Final migration count: **86** —
unchanged, because this mission wrote no migration.

### 1.1 Recorded environment condition — port collision

`supabase/config.toml` declares ports 54321–54323. All three were held by the
running `hsa_eco` local stack, so the KitLuy stack could not start under its own
configuration.

Rather than stop an unrelated ecosystem's containers or edit tracked
configuration, validation ran from an isolated scratch workdir on ports
54341–54344, symlinking the repository's real `migrations/`, `seed/` and
`tests/` directories. **The repository was not modified to make the run
succeed.** Host `psql` is absent; the repository's own documented
`docker exec` fallback was used.

This is an environment condition for the owner to resolve, not a code defect. A
permanent fix is to move KitLuy's local ports off the HSA range in
`config.toml` — a one-line owner decision, deliberately not taken here.

### 1.2 Generated types are stale (recorded, not fixed)

Freshly generated types are **5,394 lines**; the committed
`packages/kitluy-supabase-types/src/database.generated.ts` is **5,045**. The
committed file predates recent migrations.

**Not regenerated in place.** `pnpm db:types` targets the container
`supabase_db_kitluy-local`, which the port collision prevented from existing, and
writing a 349-line type delta from a differently-named container would be an
unrelated change to a governed generated artifact. Recorded for the owner.

---

## 2. Cloud target — THE BLOCKER

### 2.1 What exists

A Supabase project named **`kitluy-suite-monorepo-dev`**
(ref `iovxllihauhxnlkmhfeh`, `ap-southeast-1`, `ACTIVE_HEALTHY`) exists in the
organisation. Its name strongly implies it is this monorepo's dev target.

**It is not.** Read-only inspection shows it carries the **standalone donor
lineage**, not the canonical one:

| Measure                    | Canonical monorepo                | Cloud `kitluy-suite-monorepo-dev`                                            |
| -------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| Applied migrations         | 86                                | **28**                                                                       |
| Version range              | `20260726180000`–`20260807040000` | `20260711000000`–`20260731160000`                                            |
| Schema prefix              | `kitluy_*` (11 schemas)           | unprefixed domain schemas (`pos`, `iam`, `catalog`, `laundry`, `devices`, …) |
| `kitluy_*` schemas present | 11                                | **0**                                                                        |
| Version-string overlap     | —                                 | **0**                                                                        |

It also holds **real working data** — 1,518 live rows across 112 tables
(`pos` 561, `iam` 293, `shared` 259, `laundry` 140, `platform` 59,
`customers` 58, `devices` 45, `catalog` 45, `partner_api` 30, `audit` 26,
`workforce` 2).

### 2.2 Why this is a stop condition

Applying the canonical 86-migration chain to that project would:

- collide two lineages that share **no** migration version and **no** schema;
- create 11 new schemas alongside 40 unrelated ones;
- put 1,518 rows of working data at risk;
- leave a database matching neither lineage's expectations.

This meets the mission's §39 escalation conditions. **The unit was stopped and
nothing was applied.** Per the mission's §9 instruction, credentials were not
invented, no secret was printed, and all code was prepared locally.

### 2.3 What is required from the owner

1. **A NEW, EMPTY Supabase project for the canonical lineage.** The canonical
   chain is proven to apply from zero; it needs an empty target, not a merge.
   Suggested name: `kitluy-monorepo-dev` (or `-staging`).
2. **Its project reference**, recorded in repository configuration — no such
   reference exists anywhere in the repository today.
3. **A ruling on the existing `kitluy-suite-monorepo-dev` project** — its name
   is misleading given its contents. Rename, retire or reclassify.
4. **Confirmation of the intended environment** (`development` or `staging`).

Once (1) and (2) exist, deployment is mechanical: `supabase link`, inspect
remote migration state, apply additively, verify schema/RLS/functions. It stays
`DEPLOYED-STAGING` — never production-proven. `db reset` must never be run
against it.

### 2.4 A related documentation defect (recorded, not fixed)

`docs/source/imported/kitluy-suite-rebuild-bible-md-v1.1.0.md` names project ref
`qneduoifcsvjajeqmvgb` as the KitLuy Supabase project, in ten places including a
webhook callback URL. That project is **`hsa-eco-dev`** — the HSA ecosystem's
development project, a different ecosystem entirely.

The bible is an **imported, superseded** document (local canonical is v4.0.0), so
it was not edited. Recorded because anyone following its runbook would point
KitLuy at an HSA database.

---

## 3. Secrets

No credential was created, printed, committed or embedded. The only keys that
appeared in this session were the Supabase CLI's well-known local development
defaults, in an ephemeral scratch container that has no relationship to any
cloud project.
