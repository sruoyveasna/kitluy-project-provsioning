# DEC-4 — canonical cloud role graph, read-only evidence

**Date:** 2026-08-11
**Target:** `kitluy-project-pos` / `gjgbnkhuwlwhngbtrgts` (verified before every query)
**Access:** IPv4 session-mode pooler, **READ-ONLY**. No role, grant, migration,
schema, function or policy was altered.

    kitluy schemas ......... 15
    migrations applied ..... 87 / 87   (max version 20260810120000 = 0188)
    server_version ......... 17.6
    schema owner ........... postgres

---

## 1. Classification: **SECURITY-PROPERTY-SATISFIED**

The intended property —

> the ordinary migration/deployment login must not be able to *become* the
> credential-governor role merely because it created or deployed KitLuy schema

— **holds on the canonical cloud today**, proven by capability, not by inference.

### 1.1 The membership row exists…

    kitluy_credential_issuer  <-member- postgres
      grantor = supabase_admin
      admin_option  = true
      inherit_option = false
      set_option     = false

Identical shape for **every** protected governor: `kitluy_fleet_governor`,
`kitluy_activation_governor`, `kitluy_job_governor`, `kitluy_release_governor`,
`kitluy_pairing_receipt_governor`, `kitluy_customer_ingestion_governor`,
`kitluy_draft_projection_governor`, `kitluy_credential_approval_reader`.

### 1.2 …but the capability does not

    role                              MEMBER   SET     USAGE
    postgres                          true     false   false
    anon / authenticated / service_role  false  false   false
    kitluy_issuance_service           false    false   false
    kitluy_worker_service             false    false   false
    kitluy_job_governor               false    false   false
    kitluy_activation_governor        false    false   false
    kitluy_credential_approval_reader false    false   false

Live probe, run as the deployment login itself:

    PROBE: SET ROLE refused -> permission denied to set role "kitluy_credential_issuer"

`postgres` **cannot** `SET ROLE` into any governor and **does not inherit** any
governor's privileges.

---

## 2. Why the assertion fails while the property holds

`assertions.sql:11804` (control 2) tests:

    pg_has_role(v_role, 'kitluy_credential_issuer', 'member')

On PostgreSQL ≤ 15, `MEMBER` was a sound proxy for "can become this role".
**PostgreSQL 16 split that into per-grant `SET` and `INHERIT` options.** A
membership row with `SET FALSE` confers no ability to become the role at all,
yet `pg_has_role(..., 'MEMBER')` still returns true.

The same applies to every raw `exists (select 1 from pg_auth_members …)` check
in the chain: they test *row presence*, which since PG16 is no longer the same
question as *capability*.

**The assertion is stale; the security posture is sound.** The finding is a
false positive produced by a predicate that PostgreSQL 16 made obsolete.

---

## 3. Recommended DEC-4 remediation — strengthen, do not weaken

**Do not exclude `postgres` from the enumerated list.** It stays. Change the
*predicate* from row-presence to capability:

    -- before (PG≤15 proxy, false-positives on PG16+)
    if pg_has_role(v_role, 'kitluy_credential_issuer', 'member') then

    -- after (tests the actual property on PG16+)
    if pg_has_role(v_role, 'kitluy_credential_issuer', 'set')
       or pg_has_role(v_role, 'kitluy_credential_issuer', 'usage') then

This is strictly **stronger**: it asserts the thing the comment says it wants —
"a grant nobody holds is worth nothing if anybody can become the role that
does" — instead of a proxy that both false-positives here and could
false-negative elsewhere (a `SET TRUE` grant made by some path other than a
recorded direct membership would still be caught by `pg_has_role`).

**No additive migration is required for DEC-4 itself.** The cloud role
architecture already satisfies the property; only the test predicate is wrong.
The preferred "privileged bootstrap authority" architecture in the mission's §3
is, in effect, **already what Supabase provides**: `supabase_admin` is the
grantor, and it issued an administer-only grant (`SET FALSE, INHERIT FALSE`).

### 3.1 Residual risk that must be recorded, not hidden

`admin_option = true` means `postgres` **can re-grant the role to itself with
`SET TRUE`** and then become it. So the property is "not currently reachable",
not "cryptographically impossible".

Removing that would require a superuser to re-issue the grant with
`ADMIN FALSE`, which on managed Supabase is not exposed to us — `supabase_admin`
is not available to the project owner through the pooler. This is a **platform
constraint**, and it should be recorded as an accepted development-phase risk
rather than presented as solved. It is materially smaller than the original
concern: self-elevation now requires an explicit, auditable `GRANT`, not a
silent inherited capability.

---

## 4. Migration-history reconciliation (mission §4)

Cloud stores each migration's applied text in
`supabase_migrations.schema_migrations.statements`. Checked directly:

    20260729200140 (0140) : ORIGINAL — no KLREC-2026-08-07-PG16 marker
    20260730160151 (0151) : ORIGINAL
    20260806000000 (0173) : ORIGINAL
    20260810120000 (0188) : ORIGINAL

**All 14 modified migration versions are already applied to canonical cloud, in
their ORIGINAL form.** Therefore, per mission §4, in-place editing is **not**
the deployable remediation, and the applied lineage must be preserved.

### 4.1 What this means in practice

The 14 edits change only *assertion predicates inside already-executed
migrations*. They create, alter and drop nothing. Re-running an edited file
against cloud is neither possible nor necessary — those versions are recorded
as applied and will never re-execute there.

Their only real effect is on **fresh environments built from zero** (local
PG17, CI, a future cloud project). That is a legitimate purpose, and it is why
they should be kept rather than reverted.

**Recommendation:** keep the 14 edits as the *from-zero* lineage, and record
explicitly that cloud carries the original text of those versions. Anything the
cloud actually needs *changed* must go into a new additive migration — which
is exactly the situation for 0188 below.

---

## 5. Migration 0188 — a real cloud defect requiring additive repair

Verified on cloud:

    record_factory_qa_v1              owner=postgres   secdef=true
    factory_qa_executions    rls=true force=true owner=postgres  policies=0
    factory_qa_check_results rls=true force=true owner=postgres  policies=0
    record_factory_qa_v1 owner login-capable: TRUE

The cloud **does** contain the unsafe state:

- a SECURITY DEFINER function owned by a **login-capable, BYPASSRLS** role;
- `FORCE ROW LEVEL SECURITY` declared with **zero policies**, so the declared
  row security is decorative — the door works only because its owner bypasses
  RLS;
- the `grant … to service_role` lines in 0188 can never take effect.

**This requires a new additive migration**, not a rewrite of applied 0188.

    next canonical version : 20260811xxxxxx_0189_factory_qa_definer_ownership_repair.sql

It must: reassign `record_factory_qa_v1` to the NOLOGIN `kitluy_fleet_governor`
(borrowing and returning membership per group 0140), add explicit governor
grants and policies on both tables, and carry regression assertions proving the
owner is NOLOGIN, the service path still works, RLS stays enforced, and the
function is not executable outside its intended grants.

**Not yet written — awaiting owner review per mission §8**, because it changes
SECURITY DEFINER ownership and privileged role architecture.

### 5.1 Relationship to the local in-place edit

The clean-PG17 gate already carries this fix *in-place inside 0188* (recorded in
`30_…PROOF.md` §3.1). That is correct for from-zero environments and must NOT
be the cloud remediation. Both are needed, and they are not duplicates:

| Environment | Mechanism |
| ----------- | --------- |
| fresh / from-zero | corrected 0188 (in place) |
| canonical cloud (0188 already applied) | additive 0189 repair |

---

## 6. Answers to the mission's explicit questions

    Can postgres become kitluy_credential_issuer?  NO  (SET=false, probe refused)
    Can postgres become kitluy_fleet_governor?     NO  (SET=false)
    Why does MEMBER say true?                      a PG16 auto-grant row exists
    Through which pg_auth_members row?             roleid=<governor>, member=postgres
    Who is the grantor?                            supabase_admin (bootstrap superuser)
    Which options are set?                         admin=true, inherit=false, set=false

    Classification: SECURITY-PROPERTY-SATISFIED
    Residual risk:  admin_option=true permits deliberate, auditable self-grant
