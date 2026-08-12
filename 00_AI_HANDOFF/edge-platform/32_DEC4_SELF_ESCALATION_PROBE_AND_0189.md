# DEC-4 self-escalation probe, 0189 repair, and migration reconciliation

**Date:** 2026-08-11
**Status:** **TESTED-IN-DEV — clean PG17 from zero is fully green.**
0189 is authored and locally validated. **No cloud write was performed.**

---

## 1. The decisive probe (§4) — run on a disposable cluster, never on cloud

A throwaway PG17.6.1.155 cluster was given the **exact** cloud membership shape
before the probe:

    BEFORE
      member=postgres  grantor=supabase_admin  admin=true  inherit=false  set=false
      postgres         super=false  createrole=true
      SET=false  USAGE=false  MEMBER=true      <-- identical to cloud

Then, connected **as `postgres`** (the deployment login):

    1. direct SET ROLE            -> refused: permission denied to set role
                                     "kitluy_credential_issuer"
    2. GRANT kitluy_credential_issuer TO postgres WITH SET TRUE
                                  -> SUCCEEDED
    3. SET ROLE (retry)           -> SUCCEEDED, current_user =
                                     kitluy_credential_issuer

    AFTER
      member=postgres  grantor=supabase_admin  admin=true  inherit=false set=false
      member=postgres  grantor=postgres        admin=false inherit=true  set=true
      SET=true  USAGE=true

**The owner's suspicion is confirmed.** `ADMIN OPTION` is sufficient for the
deployment login to grant itself the governor and then exercise it.

### Two properties, separately classified

    IMMEDIATE_GOVERNOR_ACCESS ........ NOT PRESENT   (Property A holds)
    ADMINISTRATIVE_SELF_ESCALATION ... PRESENT       (Property B violated)

My previous report classified DEC-4 as SECURITY-PROPERTY-SATISFIED. That was
correct **only** under the narrow immediate-capability reading. Under the
stronger invariant it is **violated**, and this document supersedes that
classification.

### One mitigating fact, stated precisely

The escalation is **not silent**. It leaves a second, distinguishable row —
`grantor = postgres`, `set = true` — which any assertion can detect, and it
requires an explicit `GRANT`. It is an auditable privileged action, not an
ambient capability. That is materially weaker than "postgres can already act as
the governor", and materially stronger than "postgres cannot".

---

## 2. Intended invariant (§3) — genuinely ambiguous, escalated as DEC-5

No canonical decision document states either invariant. Searched:
`docs/decisions/*.md`, the decision-and-reconciliation register, and the
assertion's own commentary.

The closest evidence is the assertion's own comment:

> A grant nobody holds is worth nothing if anybody can become the role that
> does. The governor is NOLOGIN; **this is the check that keeps it unreachable.**

"Unreachable" leans toward **invariant 2** (cannot directly *or indirectly*
authorize itself), but a code comment is not authority, and the check as written
only ever tested invariant 1's proxy.

**Recorded as DEC-5, a narrow owner decision.** It does not block Pi work.

| Option | Consequence |
| ------ | ----------- |
| Invariant 1 (immediate only) | Current state passes. Accepts an auditable escalation path in dev. |
| Invariant 2 (incl. administrative) | Requires a superuser to re-issue every governor grant with `ADMIN FALSE`. **Not reachable on managed Supabase** — `supabase_admin` is not exposed to the project owner through the pooler. Would need Supabase support or a platform mechanism. |

---

## 3. The assertion model now implemented (§2)

`assertions.sql` control 2 reports **both**, and suppresses neither:

- **Property A — `IMMEDIATE_GOVERNOR_ACCESS`** — a hard finding, using
  `pg_has_role(..., 'SET' | 'USAGE')`. This is the invariant the chain can
  enforce on every supported major.
- **Property B — `ADMINISTRATIVE_SELF_ESCALATION`** — raised by name as a
  `NOTICE` on every run, listing each non-superuser holding `ADMIN OPTION`.

`MEMBER` is no longer used for either question. Since PG16 a membership row with
`SET FALSE / INHERIT FALSE` confers no capability, so `MEMBER` answers neither —
proven on cloud, where `MEMBER=true` while `SET ROLE` is refused.

Property B is a notice rather than a hard failure **because its status is
undecided (DEC-5)** and because no migration can clear it: the auto-grant's
grantor is the bootstrap superuser. Hard-failing would leave every environment
permanently red for a platform condition; silently passing would hide a real
path. It is therefore named on every run. Observed in the green run:

    NOTICE: control 2 ADMINISTRATIVE_SELF_ESCALATION: postgres holds ADMIN
            OPTION on the credential governor and can grant itself SET
            (DEC-5, open)

---

## 4. Migration 0189 (§6) — authored, locally green, NOT deployed

    supabase/migrations/20260811090000_0189_factory_qa_definer_ownership_repair.sql

**Purpose.** Repair the 0188 defect additively: `record_factory_qa_v1` was
SECURITY DEFINER owned by login-capable, BYPASSRLS `postgres`, while both
evidence tables declared `FORCE ROW LEVEL SECURITY` with **zero policies** — so
the row security was decorative and 0188's `service_role` grants could never
take effect.

**Ownership.** Moves to NOLOGIN, non-BYPASSRLS `kitluy_fleet_governor` — the
same governor that owns `ingest_device_health_report_v1` (group 0177), so the
door joins an established pattern rather than inventing an owner. Membership is
borrowed and returned per group 0140. Idempotent: a re-run on a repaired
database is a no-op.

**RLS.** Because the governor cannot bypass RLS, the write path must be
*stated*: `select, insert` grants plus one policy per table scoped to the
governor alone. No `anon`/`authenticated`/`service_role` policy is created — the
client surface stays fail-closed and writes still arrive only through the
governed door. No `update`/`delete` is granted: both tables are append-only by
0188's triggers, and granting a privilege the design forbids would weaken the
statement.

**Self-assertions** (all passed on the clean run): owner is
`kitluy_fleet_governor`; owner is neither login-capable nor BYPASSRLS; still
SECURITY DEFINER; `search_path` still pinned; not EXECUTE-able by PUBLIC, anon
or authenticated; FORCE RLS still on **and now backed by a policy**; no
client-facing policy introduced.

**Rollback** (no data loss; nothing is created, altered or dropped structurally):

    alter function kitluy_devices.record_factory_qa_v1(...) owner to postgres;
    drop policy fqe_governor  on kitluy_devices.factory_qa_executions;
    drop policy fqcr_governor on kitluy_devices.factory_qa_check_results;
    revoke select, insert on <both tables> from kitluy_fleet_governor;

**Cloud delta if applied:** one function owner changes; two policies and two
table grants are added. No row is read, written or migrated.

---

## 5. Historical-migration reconciliation (§8)

Diffs preserved **before** any restoration, at
`00_AI_HANDOFF/edge-platform/preserved-diffs/`:

    pg16-createrole-14-migrations.patch   301 lines
    pg16-createrole-test-files.patch      313 lines
    0188-with-inplace-repair.sql.bak      617 lines

### Classification of all 14 modified historical migrations

Measured, not asserted — added lines matching any DDL/DML pattern
(`create table|index|function|policy|type`, `alter table`, `drop`, `insert`,
`update`, `delete`):

    all 14 files ........ 0 added DDL/DML lines

**Every one is category B — embedded assertion/test-only change.** They alter
predicates inside `do $$ … $$` assertion blocks and nothing else. No database
object, row or grant differs between the original and modified text.

**Action taken:** kept as-is. They are the from-zero lineage and are required
for a fresh PG17 build to pass its own embedded assertions. Because they change
no database behaviour, the deployed cloud lineage and the repository remain in
agreement about *what the database is* — they differ only in what the migration
asserts while running, on environments that have not run it yet.

### 0188 — restored to its applied form

0188 **was** edited in place by the previous continuation. Because version
`20260810120000` is recorded as applied on canonical cloud, that edit has been
**removed** and the file restored to the text cloud actually executed. The
repair now lives solely in additive 0189. The removed block is preserved in
`0188-with-inplace-repair.sql.bak`.

No destructive Git command was used; the edit was reverted by removing exactly
the lines that had been added.

---

## 6. Clean PG17 gate — green from zero

    image ......... public.ecr.aws/supabase/postgres:17.6.1.155  (cloud's tag)
    role shape .... postgres super=false createrole=true         (cloud's shape)

    MIGRATIONS   88 / 88 applied from zero      (87 historical + 0189)
    0189 self-assertion                          PASS
    SEEDS        reference-data + dev-fixtures   OK
    ASSERTIONS   exit 0, 105 PASS                GREEN
    RLS TESTS    exit 0, 137 PASS                GREEN
    DEC-5        1 escalation notice raised      (reported, not suppressed)

### Container fidelity shims — test environment only, never the repository

The base image is not a complete Supabase stack. Three gaps were closed with
definitions taken from the working stack, and each materially changed the
result:

| Shim | Evidence it was needed |
| ---- | ---------------------- |
| `auth.uid()` / `auth.role()` (claims-aware) | base image ships the legacy `request.jwt.claim.sub`-only form; RLS went **6 → 126 PASS** |
| `auth.jwt()` | absent entirely (3 auth functions vs 4) |
| 15 `auth.users` columns (`email_confirmed_at`, `phone`, …) | base image has **21** columns, the real stack **35**; all GoTrue-managed |

Without these the suites fail on the *harness*, not the chain. Reporting those
failures as chain defects would have been wrong.

**`assertions.sql` is not re-runnable** against the same database — a second
pass fails on `device_generation_keys_fingerprint_key`. Every verdict above is a
single pass on a fresh cluster.
