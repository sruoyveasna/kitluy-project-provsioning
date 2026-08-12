# Clean PostgreSQL 17 canonical chain proof

**Date:** 2026-08-10
**Status:** **TESTED-IN-DEV — migrations and RLS green from zero; assertions
88 PASS with ONE genuine blocker remaining (DEC-4).**

---

## 1. The target — genuinely clean and faithful

The previous evidence (`14_…DEPLOYMENT.md` §3) was produced against a *dirty*
database. This run used a disposable cluster created from zero:

    container ...... kitluy-pg17-clean (disposable)
    image .......... public.ecr.aws/supabase/postgres:17.6.1.155
    server_version . 17.6
    port ........... 55432

`17.6.1.155` was chosen deliberately: it is the exact image tag of the
canonical cloud project, so the gate predicts cloud behaviour rather than
approximating it.

### 1.1 Role fidelity — the part that decides whether the test is real

The PG16 `CREATEROLE` behaviour only manifests for a **non-superuser** role
holding `CREATEROLE`. A bare container makes `postgres` a superuser, which
would mask the entire class of defect and produce a false green.

The image's own initialisation produces the correct shape, verified before use:

    postgres  super=false  createrole=true      <-- matches cloud
    anon / authenticated / service_role present

### 1.2 Two fidelity shims applied to the CONTAINER only

Neither is a repository change. Both close gaps between the base image and the
Supabase CLI local stack:

| Shim | Why |
| ---- | --- |
| `auth.uid()`, `auth.role()` | The base image ships the **legacy** implementation reading only `request.jwt.claim.sub`. The CLI stack ships one that also reads `request.jwt.claims->>'sub'`, which is what the tests set. Without this, RLS positive controls fail and every scope test is meaningless. |
| `auth.jwt()` | Absent from the base image entirely (3 auth functions vs 4 in the working stack). |

**Evidence this mattered:** RLS went from **6 PASS** to **126 PASS** on
installing the correct `auth.uid()` alone. Reporting the earlier number as a
chain verdict would have been wrong.

---

## 2. Result

    MIGRATIONS   87 / 87   applied from zero          ✅
    SEEDS        reference-data + dev-fixtures OK     ✅
    RLS TESTS    137 PASS, exit 0                     ✅ GREEN
    ASSERTIONS   88 PASS, 1 blocking finding          ⚠️  DEC-4

**The PG16/PG17 `CREATEROLE` blocker recorded in `14_…DEPLOYMENT.md` §3 is
resolved.** The chain no longer fails at migration 51/86 or 40/86; it applies
completely.

---

## 3. Defects found and fixed

### 3.1 Migration 0188 — SECURITY DEFINER owned by a login-capable role

Found only by a clean-from-zero run: `0188` was never applied to the local
PG17 stack (which held 86), so nothing had exercised it.

    ASSERT FAIL: kitluy_devices.record_factory_qa_v1(...) is SECURITY DEFINER
                 owned by login-capable postgres

This was **not cosmetic**. `0188` declares `ENABLE + FORCE ROW LEVEL SECURITY`
on `factory_qa_executions` and `factory_qa_check_results` but creates **no
policies at all**. The door therefore worked only because its owner
(`postgres`) holds `BYPASSRLS` — the declared FORCE RLS was decorative, and the
`grant … to service_role` lines could never take effect.

**Fix** (house style, group 0177): ownership moved to the NOLOGIN
`kitluy_fleet_governor` — the same governor that owns
`ingest_device_health_report_v1`, the other device-evidence ingestion door —
with explicit governor grants and policies, so the write path is *stated*
rather than inherited from a BYPASSRLS identity. Reassignment borrows and
immediately returns governor membership, mirroring group 0140.

### 3.2 `assertions.sql` — untyped array append

    ERROR: malformed array literal: "control 4: a non-superuser role is a
           member of the approval reader"

`text[] || <untyped literal>` resolves as array‖array. A latent bug that fires
only when the finding is non-empty — so it hid a real finding behind a syntax
error. Two sites cast to `::text`. The sibling append survived only because
`format()` returns typed text.

### 3.3 PG16 exclusions missing from the test files

The `KLREC-2026-08-07-PG16-CREATEROLE-001` correction had been applied to the
14 migrations and to *some* checks, but not all. Completed in the same recorded
style (exclude only the un-removable auto-grant; a borrow this chain took
itself still has `grantor = member` and is still a finding):

    rls-tests.sql   WS11-N19 re-delegation check     (ADMIN OPTION variant)
    assertions.sql  4 membership checks

---

## 4. DEC-4 — the remaining blocker, which must NOT be patched away

    ASSERT FAIL: control 2: postgres can become the credential governor,
                 so revoking the grant bought nothing

`assertions.sql:11804` enumerates roles — including `postgres` — and asserts
none can `pg_has_role(..., 'kitluy_credential_issuer', 'member')`. Its own
comment states the intent:

> A grant nobody holds is worth nothing if anybody can become the role that
> does. The governor is NOLOGIN; this is the check that keeps it unreachable.

On PostgreSQL 16+, a non-superuser with `CREATEROLE` is **permanently and
un-removably** a member of every role it creates: the auto-grant's grantor is
the bootstrap superuser, so the deploying role cannot revoke it from itself.

**This is a real security-property regression from PG15, not a test defect.**
Excluding `postgres` here would delete the property the check exists to
enforce, which is exactly what work-sequence §6 forbids. It was therefore left
failing and is escalated.

### Options

| # | Choice | Consequence |
| - | ------ | ----------- |
| A | Create governor roles from a **superuser** (`supabase_admin`) so `postgres` never receives the auto-grant | Cleanest. Requires superuser at deploy time — may be unavailable on hosted Supabase. |
| B | Revoke `CREATEROLE` from `postgres` after role creation | Does **not** help: existing memberships persist after the attribute is dropped. |
| C | A superuser explicitly revokes each auto-grant post-deployment | Works, but is an out-of-band step the chain cannot assert for itself. |
| D | Re-scope the assertion to state that on PG16+ the deploying role can assume governor roles, and move the property to a deployment control | Honest, but weakens a reviewed security boundary — owner decision. |

### An important lead

`KLD-2026-08-10-CLOUD-TARGET-001` records the canonical cloud project
`kitluy-project-pos` as **87/87 applied**. If that is accurate, this condition
was already met or accepted there. **Determine how before choosing an option** —
the answer may already exist.

---

## 5. Reproduction

    docker run -d --name kitluy-pg17-clean -e POSTGRES_PASSWORD=postgres \
      -p 55432:5432 public.ecr.aws/supabase/postgres:17.6.1.155
    # install CLI-stack auth.uid()/auth.role()/auth.jwt()  (see §1.2)
    for f in supabase/migrations/*.sql; do
      docker exec -i kitluy-pg17-clean psql -U postgres -v ON_ERROR_STOP=1 -q -f - < "$f"; done
    # seeds need:  set kitluy.environment='local';
    docker exec -i kitluy-pg17-clean psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/assertions.sql
    docker exec -i kitluy-pg17-clean psql -U postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/rls-tests.sql

**`assertions.sql` is not re-runnable against the same database** — a second
pass fails on `device_generation_keys_fingerprint_key`. Every verdict above
comes from a single pass on a fresh cluster. The earlier "duplicate key"
result recorded in `28_…BLOCKERS.md` was this, and was correctly identified as
a fixture collision rather than a chain failure.

---

## 6. Files this continuation changed

    supabase/migrations/…0188_factory_qa_durable_evidence.sql   (was untracked)
    supabase/tests/assertions.sql                               (already dirty)
    supabase/tests/rls-tests.sql                                (already dirty)

Nothing else. Not committed, not pushed.
