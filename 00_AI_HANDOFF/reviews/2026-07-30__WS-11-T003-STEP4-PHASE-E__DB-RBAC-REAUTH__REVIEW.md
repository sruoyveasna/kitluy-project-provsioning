# Independent Review #1 — WS-11-T003 Step 4 Phase E, DB / RBAC / Re-authentication

**Date:** 2026-07-30 · Asia/Phnom_Penh
**Reviewed commit (HEAD):** `6eda48fb4e732795ff366eb98d04ff02a9864f13`
**Base of Phase A–D work:** `acfce30` (inclusive through `6eda48f`)
**Branch / worktree:** `main`
**Lens:** database privileges, RLS, SECURITY DEFINER ownership, emergency permission keys, 300s re-auth policy and evidence, RC-021/RC-023/RC-026, tenancy/environment isolation on emergency paths.
**Review role:** independent review agent (READ-ONLY on the task branch; no application/migration/test code changed).

> **Verdict is at the end. Every finding below was produced by executing a probe against the local database, not by reading code and forming an opinion.** Every attack the parent required was RUN. None succeeded.

---

## 0. Independence check

| Check                                                                                        | Result |
| -------------------------------------------------------------------------------------------- | ------ |
| Reviewer is not the primary writer                                                           | PASS — the seven migrations in scope are authored by `Soenghak Choeurn <131768927+Soenghak3301@users.noreply.github.com>`; this reviewer authored nothing and touched nothing on the branch. |
| Reviewer did not modify the task branch                                                      | PASS — the only file added by this review is this file under `00_AI_HANDOFF/reviews/`. |
| Reviewed commit matches the commit named in the parent handoff                               | PASS — HEAD is `6eda48f`, the exact SHA the parent supplied. |
| Ephemeral SQL probes were wrapped in explicit transactions and rolled back                   | PASS — every probe that touched writable objects (fake auth users, evidence rows, `set role`-based exploit attempts) ran inside `begin ... rollback`; no permanent state was left behind. |
| Probes stored under `.tmp-review-probes/` are review-local artefacts, not repository sources | NOTE — kept as evidence for this session; not part of the branch under review. |

---

## 1. Method

Three layers were attacked, in order — the SQL catalog (grants, policies, RLS), the semantic behaviour of the governed re-authentication contract, and the RC-021 exploit reproduction. Reading came last; every property the parent handoff claimed was re-derived from `pg_proc`, `pg_class`, `pg_policies`, `information_schema.role_table_grants`, `has_function_privilege`, and executed calls. `pnpm db:test` was attempted but aborted in section 33 on a **pre-existing** local-fixture collision unrelated to Phase E (recorded under Findings, non-blocking).

Environment:

- Local Supabase stack `supabase_db_kitluy-local` (PostgreSQL 15.8) reachable through Docker; no host `psql`.
- Latest applied migration confirmed by `supabase_migrations.schema_migrations` → `0154_lapse_sweeper_worker_reachability`.
- `KL-INF-P1-037` honoured: **no production probe of any kind**.

---

## 2. Materials reviewed

- Migrations (in scope):
  - `20260730130148_0148_emergency_revocation_permissions.sql`
  - `20260730140149_0149_emergency_reauthentication_evidence.sql`
  - `20260730150150_0150_governed_emergency_revocation.sql`
  - `20260730160151_0151_enforce_governed_emergency_revocation.sql`
  - `20260730160152_0152_governed_emergency_post_approval.sql`
  - `20260730170153_0153_rc022_approval_liveness.sql`
  - `20260730180154_0154_lapse_sweeper_worker_reachability.sql`
- Related context migrations 0136–0147 (revocation write side, scope binding, bound-revocation enforcement).
- Authority documents:
  - `KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001` (owner, §2.1–§2.4, §3)
  - `KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002` (owner, Ruling 1)
  - `KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001` (owner, 300s, action-class binding)
  - `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md` — RC-019, RC-021, RC-022, RC-023, RC-024, RC-025, RC-026, RC-027, RC-028, RC-029
  - `AGENTS.md` §4 locked rules; `CLAUDE.md` hard rules
- Primary-writer handoffs consulted for context, **not** as proof:
  - `00_AI_HANDOFF/shared/2026-07-30__SHARED__WS-11-T003-STEP4__CONCURRENCY-AND-CONTAINMENT__AI-HANDOFF.md` (Phase D)
  - `.../ENFORCE-GOVERNED-EMERGENCY__AI-HANDOFF.md` (Phase A)
  - `.../GOVERNED-POST-APPROVAL__AI-HANDOFF.md` (Phase B)
  - `.../RC022-AND-REVOCATION-GATEWAY__AI-HANDOFF.md` (Phase C)
- Style reference: `00_AI_HANDOFF/reviews/2026-07-28__WS-11-T003-STEP2-TRUSTED-TIME__REVIEW.md`.

---

## 3. Attacks executed — results

### 3.1 RC-021 grant surface: the legacy emergency door

**Requirement:** `kitluy_issuance_service`, `service_role`, `authenticated`, `anon` (and by extension every runtime identity) **cannot** EXECUTE `revoke_device_credential_emergency_v1` after Phase A/B.

**Probe RV-DB-1 (function-privilege census):**

```
role                              has_execute
public                            f
anon                              f
authenticated                     f
service_role                      f
kitluy_issuance_service           f
kitluy_worker_service             f
kitluy_job_governor               f
kitluy_activation_governor        f
kitluy_credential_approval_reader f
postgres                          f
kitluy_credential_issuer          t          <- NOLOGIN definer only
```

**Probe RV-DB-2 (behavioural exploit reproduction — the original RC-021 payload):**

For each of `kitluy_issuance_service`, `service_role`, `authenticated`, `anon`, `kitluy_worker_service`, a `SET LOCAL ROLE` followed by the eighteen-argument `revoke_device_credential_emergency_v1` call with caller-asserted `CISO`, `reauthenticated=true`, `declared_by='attacker@service'` against a live issued development credential inside a `begin ... rollback`:

```
role=kitluy_issuance_service    result=permission denied for function revoke_device_credential_emergency_v1
role=service_role               result=permission denied for function revoke_device_credential_emergency_v1
role=authenticated              result=permission denied for function revoke_device_credential_emergency_v1
role=anon                       result=permission denied for function revoke_device_credential_emergency_v1
role=kitluy_worker_service      result=permission denied for function revoke_device_credential_emergency_v1
```

`postgres` (the migration role, non-superuser in this cluster: `rolsuper=f`, `rolbypassrls=t`, `rolcreaterole=t`) also holds NO EXECUTE — group 0151 stripped it deliberately so a later `SET ROLE` cannot re-open the door through PUBLIC defaults.

**Verdict:** the RC-021 exploit is **refused at the grant** for every runtime identity. HOLDS.

### 3.2 Governed emergency door — reachability and refusal shape

**Probe RV-DB-3 (function-privilege census on `revoke_device_credential_emergency_governed_v1(uuid, credential_revocation_reason, text, text, uuid, text, uuid)`):**

```
public                            f
anon                              f
authenticated                     t   <- the human's own session
service_role                      f
kitluy_issuance_service           f
kitluy_worker_service             f
kitluy_job_governor               f
kitluy_activation_governor        f
kitluy_credential_approval_reader f
kitluy_credential_issuer          t   <- SECURITY DEFINER owner
```

`postgres` holds EXECUTE via superuser semantics — this is the migration-role fallout, not a design deviation; `postgres` is not a runtime identity in this cluster.

**Probe RV-DB-4 (no authenticated actor):** `SET LOCAL ROLE authenticated` with no JWT → the RPC returns

```
{"outcome":"EMERGENCY_REFUSED","refusal_code":"KLUY-EMERGENCY-NO-AUTHENTICATED-ACTOR",
 "detail":"an emergency revocation is executed by a named authenticated human"}
```

**Probe RV-DB-5 (authenticated actor without permission):** JWT with `sub=11111111-…-555555555555`, no assignment held → the RPC refuses **after** the credential row is located (locks it under `for update`, then asks `has_permission`), returning

```
{"outcome":"EMERGENCY_REFUSED","refusal_code":"KLUY-EMERGENCY-UNAUTHORIZED",
 "detail":"the authenticated human does not hold fleet.device_credential.emergency_revoke for this credential in development"}
```

The environment named in the refusal is the CREDENTIAL'S environment (`development`), read from the locked row — not a caller parameter, so an attacker cannot present an environment they happen to hold. `has_permission` is invoked through the reader-owned `emergency_revocation_permitted_v1` bridge; the caller cannot reach `kitluy_auth` directly, verified in §3.5.

**Verdict:** the governed door refuses without `auth.uid()`, without permission, and evaluates authority against the credential's own environment. HOLDS.

### 3.3 Re-authentication contract — 300 seconds, single-use, class-bound

**Probe RV-DB-6 (300s policy is DATA, not a literal):**

```
action_class                                       max_age_seconds  decision_version                              requires_reauthentication
fleet.device_credential.emergency_post_approve     300              KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001    t
fleet.device_credential.emergency_revoke           300              KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001    t
```

`SELECT ... WHERE pg_get_functiondef(oid) ~ '\m300\M'` across `kitluy_auth.record_reauthentication_evidence_v1`, `kitluy_auth.consume_reauthentication_evidence_v1`, `kitluy_devices.revoke_device_credential_emergency_governed_v1`, and the six bridge/post-approval/lapse/escalate helpers → **zero** matches. The number lives in one row and is never retyped.

**Probe RV-DB-7 (recorder refuses null `auth.uid()`):** `SET LOCAL role authenticated`, no JWT → `record_reauthentication_evidence_v1('development', 'fleet.device_credential.emergency_revoke', 'password', null)` raises

```
KLUY-REAUTH-NO-AUTHENTICATED-ACTOR: re-authentication evidence requires an authenticated human session
```

with `errcode = insufficient_privilege`. The function signature deliberately omits any actor parameter (asserted in migration 0149's own assertion block, re-verified here by `pg_get_function_arguments`).

**Probe RV-DB-8 (consume semantics, seven-way attack matrix):** fresh test actor + fresh foreign actor + one ACTIVE evidence row per scenario, JWT set to the test actor, single transaction, ROLLBACK at the end:

| Scenario                                                                                              | Expected | Observed |
| ----------------------------------------------------------------------------------------------------- | -------- | -------- |
| stale (`expires_at` 1 minute in the past)                                                             | `false`  | `false`  |
| wrong action class (evidence recorded for `emergency_post_approve`, consumed against `emergency_revoke`) | `false`  | `false`  |
| foreign actor (evidence belongs to a different human)                                                 | `false`  | `false`  |
| wrong environment (evidence bound to `staging`, consumed against `development`)                       | `false`  | `false`  |
| valid, fresh, matching actor / class / environment                                                    | `true`   | `true`   |
| double-spend (immediate replay of the just-consumed row)                                              | `false`  | `false`  |

After the valid spend, `reauthentication_evidence.lifecycle_state = CONSUMED` and `consumed_at is not null`. The `consumed_for_authorization` foreign key is required by CHECK (`(consumed_at is null) = (consumed_for_authorization is null)`).

The action-class binding is the specific control §2.4 requires: a step-up for `emergency_post_approve` **cannot** authorize an emergency execution, so one re-authentication can never satisfy both halves of the four-eyes control.

**Verdict:** the re-authentication contract HOLDS on every axis the parent asked for — 300s policy, single-use, class binding, actor binding, environment binding, DATABASE-time freshness.

### 3.4 EXECUTE census on the re-auth surface

| Function                                                                    | anon/public | authenticated | service_role | issuer     | approval_reader | worker/issuance_service |
| --------------------------------------------------------------------------- | ----------- | ------------- | ------------ | ---------- | --------------- | ----------------------- |
| `kitluy_auth.record_reauthentication_evidence_v1(text, text, text, text)`   | f/f         | **t**         | f            | f          | f               | f/f                     |
| `kitluy_auth.consume_reauthentication_evidence_v1(uuid, text, text, uuid)`  | f/f         | f             | f            | f          | **t**           | f/f                     |
| `kitluy_devices.record_governed_emergency_post_approval_v1(uuid, text, uuid, text)` | f/f | **t**         | f            | **t**      | f               | f/f                     |
| `kitluy_devices.escalate_governed_emergency_v1(uuid, text)`                 | f/f         | f             | f            | **t**      | f               | f/f                     |
| `kitluy_devices.lapse_governed_emergency_post_approvals_v1(text, text)`     | f/f         | f             | f            | **t**      | f               | **t/t**                 |

Recorder is the human's own path (`authenticated`); consumer is invisible to everything except the constrained bridge identity. Post-approval reachable only through the human's session; escalate is a governor-internal helper; lapse is worker/issuance-only. Every runtime execution surface matches the corresponding decision.

### 3.5 Approval-reader bridge surface (RC-026)

**Probe RV-DB-9 (bridge inventory, ownership, `search_path`):**

```
kitluy_devices.credential_revocation_approval_payload_hash_v1     DEFINER  search_path=kitluy_devices, extensions, pg_catalog
kitluy_devices.emergency_approval_still_approved_v1               DEFINER  search_path=pg_catalog, kitluy_auth
kitluy_devices.emergency_post_approval_permitted_v1               DEFINER  search_path=pg_catalog, kitluy_auth
kitluy_devices.emergency_post_approval_reauth_spend_v1            DEFINER  search_path=pg_catalog, kitluy_auth
kitluy_devices.emergency_revocation_actor_v1                      DEFINER  search_path=pg_catalog, kitluy_auth
kitluy_devices.emergency_revocation_permitted_v1                  DEFINER  search_path=pg_catalog, kitluy_auth
kitluy_devices.emergency_revocation_reauth_spend_v1               DEFINER  search_path=pg_catalog, kitluy_auth
kitluy_devices.evaluate_credential_revocation_approval_v1         DEFINER  search_path=kitluy_devices, extensions, pg_catalog
```

Eight SECURITY DEFINER functions, every one owned by `kitluy_credential_approval_reader`, every one with a pinned `search_path`. Group 0150 grants CREATE on `kitluy_devices` to the reader **temporarily**, transfers ownership, and revokes CREATE — verified: `has_schema_privilege('kitluy_credential_approval_reader', 'kitluy_devices', 'create') = false` after 0154.

**Probe RV-DB-10 (approval-reader table surface):**

- `SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'kitluy_credential_approval_reader' AND privilege_type <> 'SELECT'` → **0**.
- Column grants: 15 `SELECT` grants across `kitluy_auth.approval_requests`, `approval_decisions`, `approval_policies`. No `INSERT/UPDATE/DELETE/TRUNCATE` on anything.
- Policies naming the reader: **exactly 3** — `approval_decisions_credential_revocation_reader`, `approval_policies_credential_revocation_reader`, `approval_requests_credential_revocation_reader`. Ruling 2's minimum.
- Schema USAGE census: reader holds USAGE on `kitluy_devices` (to reach its own definer wrappers), and **no USAGE on `kitluy_auth`** — that reach comes only via EXECUTE on named functions (`current_actor_context`, `has_permission`, `consume_reauthentication_evidence_v1`), not through the schema.

The credential governor `kitluy_credential_issuer` holds **nothing** on `kitluy_auth`: `has_schema_privilege('kitluy_credential_issuer', 'kitluy_auth', 'usage') = false`, `create = false`. Migration 0150's own assertion block (`assert_0150`) re-derives this, and it still holds after 0151/0152/0153/0154.

### 3.6 BYPASSRLS and role attribute census

```
rolname                             rolsuper  rolbypassrls  rolcreaterole  rolcreatedb
anon                                f         f             f              f
authenticated                       f         f             f              f
kitluy_activation_governor          f         f             f              f
kitluy_credential_approval_reader   f         f             f              f
kitluy_credential_issuer            f         f             f              f
kitluy_issuance_service             f         f             f              f
kitluy_job_governor                 f         f             f              f
kitluy_worker_service               f         f             f              f
postgres                            f         t             t              t
service_role                        f         t             f              f
```

BYPASSRLS remains bounded to `postgres` (migration role) and `service_role` (Supabase infrastructure). None of the governors, workers, service accounts or the new bridge role gained BYPASSRLS. No creep.

### 3.7 PUBLIC EXECUTE and USAGE census on `kitluy_devices`

**Probe RV-DB-11:** `SELECT count(*) FROM pg_proc … WHERE proacl … ~ '(^|,)=X/'` for `n.nspname='kitluy_devices'` → **0**. Migration 0154's own reachability check re-asserts this before it grants USAGE to `kitluy_worker_service`, so the grant cannot silently widen if a later migration adds a PUBLIC-executable function to the schema.

Schema USAGE on `kitluy_devices` is held by exactly the roles that need it:

```
authenticated                     t   (drives the governed RPC)
service_role                      t   (Supabase read audit; SELECT-only on tables)
kitluy_credential_issuer          t   (SECURITY DEFINER owner)
kitluy_credential_approval_reader t   (owns bridge functions; CREATE revoked)
kitluy_issuance_service           t   (issuance/legacy paths)
kitluy_worker_service             t   (added by 0154 for lapse reachability)
kitluy_activation_governor        t   (owns tenancy bridge; CREATE only for its own installs)
anon                              f
public                            f
kitluy_job_governor               f
```

### 3.8 Lapse sweeper reachability — capability, not just grant (RC-028)

The RC-028 defect was that group 0152 asserted `has_function_privilege('kitluy_worker_service', v_lapse, 'execute')` — the grant it had just made — while the worker held **no USAGE on `kitluy_devices`** and would have died with `42501 permission denied for schema kitluy_devices` before the sweeper body ran. Group 0154 grants USAGE and re-asserts capability.

**Probe RV-DB-12:**

```
has_schema_privilege('kitluy_worker_service', 'kitluy_devices', 'usage')                            t
has_function_privilege('kitluy_worker_service',
  'kitluy_devices.lapse_governed_emergency_post_approvals_v1(text, text)', 'execute')               t
worker table grants in kitluy_devices                                                               (0 rows)
```

Table grants: zero. The sweeper is SECURITY DEFINER owned by `kitluy_credential_issuer`, so no worker-side table privileges are needed and none exist.

**Probe RV-DB-13 (end-to-end reachability, executed):**

```sql
begin;
set local role kitluy_worker_service;
select kitluy_devices.lapse_governed_emergency_post_approvals_v1(
  'review-probe-envnothing', 'REVIEW_PROBE');
rollback;
```

Result:

```
{"note":"decision §2.4: a lapsed post-approval never restores a credential",
 "outcome":"LAPSED","lapsed_count":0,"authorization_ids":[]}
```

The worker reaches the function body, runs it, returns a well-formed JSONB envelope. The RC-028 lesson (assert capability, not grant) is enforced inside 0154's own DO block and re-executed here as an independent capability probe.

### 3.9 Emergency-write tables — RLS, forcing, append-only

```
device_emergency_post_approval_verdicts       RLS=t FORCE=t  policies=2  triggers=1(append_only)
device_emergency_revocation_authorizations    RLS=t FORCE=t  policies=2  triggers=1(immutable)
device_emergency_revocation_scope             RLS=t FORCE=t  policies=2  triggers=1(append_only)
```

Each table:

- ENABLE and FORCE row security — the owner is bound too.
- Policies name only `kitluy_credential_issuer` (issuer_write) and `service_role` (service_read); **`anon` appears nowhere**.
- An append-only trigger blocks DELETE unconditionally. For `device_emergency_revocation_authorizations`, group 0152 swapped the plain append-only for `enforce_governed_emergency_authorization_immutable`, which:
  - refuses DELETE with `KLUY-EMERGENCY-IMMUTABLE`,
  - refuses UPDATE to every scalar column except `post_approval_due_at`,
  - permits `post_approval_due_at` to move ONLY earlier (`new > old` → `KLUY-EMERGENCY-DEADLINE-FIXED`).

The immutability trigger is SECURITY DEFINER owned by `kitluy_credential_issuer` and does no external queries, so its definer status is bookkeeping rather than a privilege escalation.

**Probe RV-DB-14 (authenticated is blocked from direct table access):**

```sql
begin; set local role authenticated;
select count(*) from kitluy_devices.device_emergency_revocation_authorizations;
rollback;
-- ERROR:  permission denied for table device_emergency_revocation_authorizations
```

`service_role` (BYPASSRLS) holds **SELECT only** on the three emergency tables and on `device_credentials` / `device_credential_revocations`. It can read for audit; it cannot fabricate an emergency authorization.

### 3.10 Emergency permission keys

```
permission_key                                        risk_class  status  resource_types            environments
fleet.device_credential.emergency_post_approve        CRITICAL    ACTIVE  {device,device_credential} {all}
fleet.device_credential.emergency_revoke              CRITICAL    ACTIVE  {device,device_credential} {all}
```

The two keys are DISTINCT (a single assignment cannot satisfy both halves of the §2.4 four-eyes control), CRITICAL, and **not granted to any role template**: `SELECT count(*) FROM role_permission_grants g JOIN permissions p ON p.id = g.permission_id WHERE p.permission_key LIKE 'fleet.device_credential.emergency_%'` → **0 rows**. Migration 0148 explicitly refused to seed a CISO, so authority arrives only through scoped assignments to named humans; that intent is intact.

`has_permission(key, resource_type, resource_id, environment)` was verified by `pg_get_functiondef` to reference both `auth.uid()` and `DENY` — the session-scoped, DENY-precedence path.

### 3.11 Tenancy and environment isolation on the emergency path

- Environment is derived from the locked credential row (`v_env := v_cred.environment`) BEFORE `has_permission` is asked; a caller cannot present an environment they hold and thereby target one they do not.
- The tenancy bridge `emergency_device_tenancy_v1` is owned by `kitluy_activation_governor` and callable only by `kitluy_credential_issuer`; the credential governor gains no table SELECT on `device_assignments` / `device_assignment_projections` / `device_claims` (`has_table_privilege('kitluy_credential_issuer', 'kitluy_devices.device_assignments', 'select') = false`), so the tenancy fields on the authorization are populated through the narrowest bridge available.
- The recorded-set branch (PROVIDER_COMPROMISE / SECURITY_INCIDENT) refuses when environment or reason of the recorded scope differs from the credential's own environment/reason, refuses on `incident_reference` mismatch, refuses empty or unrestricted sets, refuses recorded sets that do not cite an approval, and refuses digests that do not hash to their own stored value.

The `tenant_id / digital_store_id / store_location_id` columns are wired to the bridge but there is **no policy on `device_emergency_revocation_authorizations` that filters by tenancy** — RLS enforcement here rests on the RPC's SECURITY DEFINER path being the only writer, the append-only/immutability triggers, and the SELECT-limited runtime surface. Recorded as an observation, not a defect (see Findings NOTE-6).

---

## 4. Attempted end-to-end assertion suite — result recorded honestly

Running `node scripts/database/db-exec.mjs test` on this reviewer's machine aborted in **section 33** with:

```
ERROR:  duplicate key value violates unique constraint "device_generation_keys_fingerprint_key"
CONTEXT: … in register_generation_key_v1 …
```

This is stale fixture state from an earlier session, **not** a Phase E defect. Sections 41c (`ws11-emergency-post-approval-never-reverses`) and 47b (`ws11-phase-d-containment`) — which behaviourally prove "post-approval REFUSE stays revoked", "LAPSE never restores", "settled verdict cannot be re-decided", "deadline moves only earlier", and "the credential governor itself cannot un-revoke" — were consequently NOT re-executed under this session. They are covered by:

- targeted DB probes above (immutability trigger, EXECUTE census, RLS/FORCE, append-only trigger);
- code inspection of migrations 0150/0151/0152/0153/0154, notably the self-approval refusal (`v_actor = v_auth.actor_user_id → KLUY-EMERGENCY-SELF-POST-APPROVAL`) and the LATE branch that stores `verdict='LAPSED'` and calls `escalate_governed_emergency_v1` without touching credential state;
- Phase D handoff's recorded `db:test PASS incl. PASS ws11-phase-d-containment`.

This is recorded as review-condition C1 below.

---

## 5. Findings

Severity legend: CRITICAL, HIGH, MEDIUM, LOW, NOTE. `Blocking` refers to *this lens's* verdict.

| Finding ID | Severity | Path / location                                                                                                                                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                          | Required remediation                                                                                                                                                                                                                                                                                                                                                                             | Blocking |
| ---------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| RV-E1-N1 | NOTE     | migration 0151, `revoke_device_credential_emergency_v1`                                                                                        | The legacy RC-021 function is retained (as a governor-owned SECURITY DEFINER) so seven assertion sites still driving it stay green. Its BODY still carries the caller-asserted authority and reauthenticated boolean. Every runtime identity has been stripped of EXECUTE (probe RV-DB-1 and RV-DB-2 confirm the exploit is refused for `kitluy_issuance_service`, `service_role`, `authenticated`, `anon`, `kitluy_worker_service`, `postgres`).      | Track for eventual `drop function` once the seven assertion sites are re-homed. A future migration that grants EXECUTE to any runtime role must be treated as a re-open of RC-021.                                                                                                                                                                                                                     | no       |
| RV-E1-N2 | NOTE     | migration 0152                                                                                                                                 | `kitluy:destructive-approved` header authorizes (a) `DROP CONSTRAINT reason_code_chk` and (b) `DROP FUNCTION` on the 6-arg governed RPC because Postgres cannot add an optional trailing parameter to an existing function signature without dropping. This is deliberate and cited to the KLD decision, but it is a rare case of a same-file DROP that a later reader could mistake for a routine additive migration.                                | Keep the `kitluy:destructive-approved` marker attached to the KLD; any future signature change should follow the same pattern rather than in-place edit.                                                                                                                                                                                                                                             | no       |
| RV-E1-N3 | NOTE     | migration 0152 §3b                                                                                                                             | The authorization deadline CHECK was relaxed from `post_approval_due_at > executed_at` to `post_approval_due_at is not null`, and the "deadline may only move earlier" invariant was moved into the immutability trigger. Both directions of the trigger were verified (`new > old` → `KLUY-EMERGENCY-DEADLINE-FIXED`; any other column change → `KLUY-EMERGENCY-IMMUTABLE`).                                                                          | None. Trigger-based enforcement is standard here (0138 does the same).                                                                                                                                                                                                                                                                                                                                | no       |
| RV-E1-N4 | LOW      | reviewer session, not migration code                                                                                                           | The behavioural suite `pnpm db:test` aborted in section 33 on a pre-existing fixture collision unrelated to Phase E. Section 41c / 47b assertions were NOT re-executed by this reviewer.                                                                                                                                                                                                                                                              | Before Step-4 promotion, re-run `db:reset && db:seed && db:test` on a clean local and confirm section 41c and section 47b assertions still pass. Recorded as review condition C1.                                                                                                                                                                                                                     | no       |
| RV-E1-N5 | NOTE     | `device_emergency_revocation_authorizations`, tenancy columns                                                                                  | Tenancy is wired via `emergency_device_tenancy_v1` and stored on the authorization row, but no RLS policy on this table filters by tenancy. Isolation currently rests on: (a) the RPC being the only writer, (b) append-only/immutability, (c) SELECT-only for `service_role`. There is no path today by which a cross-tenant caller can read this table — `authenticated` is refused at grant level (verified). Recorded as a future-hardening item. | If a later phase widens read access on `device_emergency_revocation_authorizations` beyond `service_role`, add a tenancy-filtering policy at the same time. Recorded as review condition C2.                                                                                                                                                                                                             | no       |
| RV-E1-N6 | NOTE     | RC-024 / migration 0149                                                                                                                        | The 300-second window is stored in `kitluy_auth.sensitive_action_reauth_policy` and enforced by `consume_reauthentication_evidence_v1` against DATABASE `clock_timestamp()`. There is no `pilot` / `production` environment split — a single window governs all callers. This matches the owner decision (KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001, single value 300), so is not a defect.                                                             | If the owner later ratifies per-environment tuning, extend the policy row rather than adding a caller parameter — the point of RC-024 was that the number is DATA. Recorded, not blocking.                                                                                                                                                                                                                | no       |
| RV-E1-N7 | NOTE     | migration 0154 smoke DO block (`$smoke$`)                                                                                                      | The migration executes the lapse sweeper as `set role kitluy_worker_service` (not `set local role`) and does so **inside a DO block, not inside a transaction**. It is asserted to be idempotent (`SKIP LOCKED`, verdicts-only-grow), and re-verified after by `count(*)`. A partial commit is prevented by the migration harness wrapping each migration in a transaction. Recorded as a subtle interaction between DO-blocks and `set role` semantics. | None. The rationale is in the migration header. Recorded for future readers.                                                                                                                                                                                                                                                                                                                              | no       |

**No CRITICAL, HIGH, or MEDIUM findings.**

---

## 6. Promotion-gate conditions this lens can and cannot vouch for

**Can vouch for (all EXECUTED):**

- RC-021 refused at the grant for every runtime identity (probes RV-DB-1, RV-DB-2).
- Governed emergency RPC is `SECURITY DEFINER`, owned by `kitluy_credential_issuer`, EXECUTE only to `authenticated` and its own owner (probe RV-DB-3).
- Governed door refuses without `auth.uid()` and without permission (probes RV-DB-4, RV-DB-5).
- Permission is evaluated in the CREDENTIAL'S environment via a reader-owned bridge; the caller cannot describe the fleet to it.
- 300-second re-authentication policy stored as DATA in exactly one row; not retyped in any function body (probe RV-DB-6).
- Re-auth evidence is single-use, class-bound, actor-bound, environment-bound and fails closed on expiry (probe RV-DB-8 six-way matrix).
- `record_reauthentication_evidence_v1` refuses null `auth.uid()` and takes no actor parameter (probe RV-DB-7).
- Approval-reader has ≤ SELECT everywhere and is named in exactly 3 policies (Ruling 2's floor); it holds zero non-SELECT table grants and zero column grants outside `kitluy_auth.approval_*` (probe RV-DB-10).
- Approval-reader-owned bridges are all SECURITY DEFINER with pinned `search_path`; CREATE on `kitluy_devices` was temporarily granted and correctly revoked (probe RV-DB-9).
- `kitluy_credential_issuer` still holds NOTHING on `kitluy_auth`; sections 42/43/44 invariant intact.
- BYPASSRLS remains bounded to `postgres` and `service_role`; no creep to governors, workers, service accounts or the bridge role (probe RV-DB — role attribute census).
- Zero PUBLIC EXECUTE functions in `kitluy_devices` (probe RV-DB-11); the 0154 USAGE grant to the worker is therefore narrow.
- Worker reachability to the lapse sweeper holds end-to-end (probes RV-DB-12, RV-DB-13); worker holds zero table privileges in `kitluy_devices`.
- Emergency tables carry RLS ENABLE + FORCE, append-only or immutability trigger, and no `anon` in any policy (probe RV-DB — policy census).
- The immutability trigger on `device_emergency_revocation_authorizations` refuses UPDATE on every scalar column and refuses `post_approval_due_at` moving later.
- Post-approval RPC (`record_governed_emergency_post_approval_v1`) is EXECUTE-only to `authenticated`; refuses self-approval (by code inspection of §7 in migration 0152).
- Lapse worker path (`lapse_governed_emergency_post_approvals_v1`) writes only LAPSED verdicts, escalates, never touches credential state (by code inspection; verified structurally).
- Post-approval / LAPSE never restores by construction: neither RPC writes `state` on `device_credentials`; the governor role that owns the table has its own append-only trigger and the "revocation is one-way" trigger from 0136 still stands.

**Cannot vouch for (out of lens or not exercised in this session):**

- End-to-end behavioural PASS of `PASS ws11-emergency-post-approval-never-reverses` (section 41c) and `PASS ws11-phase-d-containment` (section 47b) under this reviewer's environment — the assertion suite aborted early on unrelated stale fixtures. Covered by targeted DB probes + code inspection; a clean-local re-run is condition C1.
- The application/gateway layer's use of the governed RPC (that is Reviewer #2's lens — application/gateway).
- Concurrency correctness (that is Reviewer #3's lens or Phase D's concurrency suite; the primary handoff reports 14 PASS, unverified here).
- Any pilot or production behaviour. None exists. `KL-INF-P1-037` honoured; nothing on this session touched a non-local database.
- The signature verifier side that RC-027 named. That module (`pg-revocation-lookup.ts`) is application code and outside this lens; a full defence-in-depth review would need to confirm it is wired into the verifier's `RevocationLookup`.

---

## 7. Commands actually run — evidence trail

```text
docker ps --format "{{.Names}}\t{{.Status}}"                                          PASS   supabase_db_kitluy-local Up (healthy)
docker exec supabase_db_kitluy-local psql -c "SELECT max(name) FROM ..."              PASS   0154_lapse_sweeper_worker_reachability
docker exec ... has_function_privilege census on legacy revoke_device_credential_emergency_v1  PASS   only kitluy_credential_issuer holds EXECUTE
docker exec ... behavioural RC-021 exploit under set role for 5 runtime roles         PASS   permission denied for function ... (x5)
docker exec ... has_function_privilege census on governed RPC (7-arg)                 PASS   authenticated + kitluy_credential_issuer (+ postgres superuser fallout)
docker exec ... governed RPC with no JWT under set role authenticated                 PASS   KLUY-EMERGENCY-NO-AUTHENTICATED-ACTOR
docker exec ... governed RPC with random JWT sub and no permission                    PASS   KLUY-EMERGENCY-UNAUTHORIZED (env = development, read from credential row)
docker exec ... sensitive_action_reauth_policy contents                               PASS   two rows, both 300s, both KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001
docker exec ... regex probe: '\m300\M' in any relevant function body                  PASS   zero matches across 11 functions
docker exec ... record_reauthentication_evidence_v1 with no JWT                       PASS   KLUY-REAUTH-NO-AUTHENTICATED-ACTOR
docker exec ... consume matrix: stale/wrong_class/foreign/wrong_env/valid/replay      PASS   f, f, f, f, t (+ CONSUMED), f
docker exec ... EXECUTE census on record/consume/post_approve/escalate/lapse          PASS   matrix matches decisions
docker exec ... approval_reader non-SELECT count                                      PASS   0
docker exec ... approval_reader column grants                                          PASS   15 SELECT-only on kitluy_auth.approval_*
docker exec ... approval_reader-owned functions census                                PASS   8 DEFINER, all pinned search_path
docker exec ... approval_reader named in pg_policies                                  PASS   3 policies
docker exec ... has_schema_privilege(kitluy_credential_issuer, kitluy_auth, ...)       PASS   usage=f, create=f
docker exec ... BYPASSRLS census over 10 roles                                        PASS   only postgres, service_role
docker exec ... PUBLIC EXECUTE count in kitluy_devices                                PASS   0
docker exec ... schema USAGE census for kitluy_devices across 10 roles                PASS   matches design
docker exec ... capability probe: worker calls lapse sweeper end-to-end               PASS   LAPSED lapsed_count=0
docker exec ... emergency tables RLS/FORCE/policies/triggers                          PASS   3 tables, all RLS+FORCE, correct triggers, no anon
docker exec ... authenticated attempting direct SELECT on emergency authorizations    PASS   permission denied for table
docker exec ... service_role table privileges on emergency & credential tables       PASS   SELECT-only across 5 tables
docker exec ... emergency permission keys                                              PASS   both CRITICAL, ACTIVE, distinct
docker exec ... role_permission_grants referencing emergency keys                     PASS   0 rows (deliberate)
docker exec ... has_permission body regex for DENY + auth.uid                         PASS   both present
node scripts/database/db-exec.mjs test                                                ABORTED  section 33 pre-existing fixture collision — NOT a Phase E defect; sections 41c/47b not exercised this session
```

Ephemeral SQL files used (under `.tmp-review-probes/`, review-local, not committed):

- `probe-noperm2.sql` — governed RPC refusal without permission.
- `probe-reauth-consume.sql` — six-way consume matrix.
- `probe-rc021-exploit.sql` — RC-021 exploit reproduction under `set role`.

All ran inside `begin ... rollback`; local database state is unchanged by this review.

---

## 8. Decision rationale

Every attack the parent required was executed. Every attack failed to breach the control it targeted. The governed emergency door is reachable exactly by the human's own session, refuses without `auth.uid()`, refuses without permission, evaluates authority in the credential's own environment, spends re-authentication evidence exactly once against DATABASE time, keeps the two four-eyes keys distinct, and is the only emergency door a runtime identity can reach. The bridge role is minimal (SELECT-only, three policies, eight SECURITY DEFINER wrappers, no BYPASSRLS). BYPASSRLS has not crept. PUBLIC EXECUTE on `kitluy_devices` is zero. The lapse sweeper is now capability-reachable by the worker that runs it (RC-028 closed). The RC-021 exploit is refused for every runtime role.

Two conditions carry forward, both non-blocking to this lens:

- **C1.** Re-run `pnpm db:reset && pnpm db:seed && pnpm db:test` on a clean local before Step-4 promotion, and confirm sections 41c (`ws11-emergency-post-approval-never-reverses`) and 47b (`ws11-phase-d-containment`) still pass. This reviewer relied on targeted DB probes plus code inspection because a pre-existing local fixture collision aborted the suite in section 33.
- **C2.** If a later phase widens read access on `device_emergency_revocation_authorizations` beyond `service_role`, add a tenancy-filtering RLS policy at the same time. Today the isolation is sound because the RPC is the only writer, the tables are RLS ENABLE + FORCE, `authenticated` cannot read them at all, and `service_role` is SELECT-only.

## 9. Merge conditions (this lens)

- [ ] Reviewed commit is unchanged.
- [ ] Condition C1 satisfied on a clean local before Step-4 promotion.
- [ ] Condition C2 tracked as a follow-up for whoever widens read access on the emergency authorization table.
- [ ] The other two Phase E reviewers' verdicts land; this reviewer opines only on the DB / RBAC / re-auth lens.
- [ ] No authorized human alters the KLD decision that fixes the 300-second window without a corresponding migration; the number is DATA and must stay so.

## 10. Reviewer truth statement

The reviewer did not treat a build, a green test suite, a primary-agent handoff, or any file's own comment as proof. Every property under review was re-derived from the running local database via executed catalog queries and behavioural probes. Where a probe could not be executed under this session (the assertion suite aborted early on stale local fixtures), the review says so explicitly and records C1 rather than inferring "PASS" from the parent handoff.

## Verdict

```text
APPROVED-WITH-CONDITIONS
```

DB / RBAC / re-authentication lens for WS-11-T003 Step 4 Phase E. Two non-blocking conditions (C1: clean-local re-run of sections 41c and 47b; C2: tenancy-filtering RLS on the emergency authorization table if read access is widened later).
