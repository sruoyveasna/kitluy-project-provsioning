# WS-11-T003 Step 4 — tenancy retraction, Hub trust and offline enforcement

| Field     | Value |
| --------- | ----- |
| Task ID   | WS-11-T003 Step 4 — offline completion §1–§7, §11 |
| Date      | 2026-07-31 · Asia/Phnom_Penh |
| Start SHA | `1cee32c` (46 ahead, clean) |
| End SHA   | `6dfeae2` (49 ahead, clean) |
| Toolchain | Node **v22.23.0**, pnpm **9.15.9** (project-external; pin unchanged) |
| Migrations| cloud through **0156** (unchanged); Hub **0027** added |
| Status    | **PARTIAL — Step 4 NOT promoted.** §1–§7 and §11 done; §8, §9, §10 NOT done |

## §2 — the defect I reported did not exist. Retracted.

Commit `1cee32c` claimed `emergency_device_tenancy_v1` and `hub_revocation_scope_v1`
were unusable because their definer owner lacked assignment access. Both halves were
wrong. Root cause of the misdiagnosis:

```
set role kitluy_issuance_service;
select kitluy_devices.emergency_device_tenancy_v1(
  (select device_id from kitluy_devices.device_assignments limit 1));
```

A function **argument is evaluated in the caller's context**, so the `42501` came
from the subselect in my own diagnostic and never reached the definer body.

Re-run with a literal:

| Call as `kitluy_issuance_service` | Result |
| --------------------------------- | ------ |
| `hub_revocation_scope_v1(<uuid>)` | **returns the full scope** — was never broken |
| `emergency_device_tenancy_v1(<uuid>)` | `42501 permission denied for FUNCTION` — **correct** |

The second is least privilege working. The bridge is granted to
`kitluy_credential_issuer`, which **owns** `revoke_device_credential_emergency_governed_v1`
and is therefore the effective role when the bridge is actually reached. Issuance
builds snapshots and has no business in the emergency tenancy path.

Forensics: `device_assignments` owner `postgres`, RLS **enabled and FORCED**;
`kitluy_activation_governor` holds SELECT; all three functions are `SECURITY DEFINER`
owned by it. No mutation occurred; every probe rolled back.

**Consequence: no migration 0157 was needed and no role was widened.** The only real
bug was already fixed in `d79a279` — inside a definer the caller is the OWNER, not the
session role, so granting `retired_devices_in_scope_v1` to `kitluy_issuance_service`
alone left the delegation from the credential-owned function refused.

## §5 — executable capability census (9 tests)

Every assertion EXECUTES as the role under test; `postgres` succeeding is never
accepted as proof. Proves: producer identity resolves a Hub scope; the emergency
path's effective identity resolves tenancy (membership borrowed inside a transaction
that ROLLS BACK, then proved gone); direct SELECT on `device_assignments`,
`device_credentials`, `devices` stays `42501` for every runtime role; the tenancy
bridge stays unreachable from the producer's identity; the readers stay unreachable
from `anon`, `authenticated`, worker; absent / null / superseded / revoked assignment
yields **no** scope; both NOLOGIN authorities cannot log in, hold no BYPASSRLS, have
no login-capable members, and no runtime role can `SET ROLE` to either.

## §6/§7 — Hub trust, persistence and offline enforcement (Hub migration 0027)

`edge_config.revocation_trust_key` holds **public halves only**, with a CHECK that
refuses a PEM containing `PRIVATE`. current/next/revoked give bounded rotation with no
Hub visit; a revoked key is refused even when its signature verifies.

**Verify then promote.** A snapshot is written `staged`, checked, and promoted in the
same transaction that demotes its predecessor. A partial unique index permits one
`active` row per scope, so the swap is atomic and last-known-good is structural.
Nothing is deleted.

**The enforced set only ever grows.** The first version read only the ACTIVE snapshot,
so a newer, correctly signed, correctly scoped, sequence-advancing snapshot that simply
OMITTED a serial would silently un-revoke it — the "reconnection restores a revoked
credential" failure, arriving through the legitimate update path. Decision §2.4 RULING 3
makes revocation irreversible, so the lookup spans every ACCEPTED snapshot.

**Three outcomes, not a boolean.** A Hub with no snapshot REFUSES rather than allows.
Staleness is reported, never hidden (§6.7 and §6.1 together).

12 live tests with no cloud connection: offline denial; allow-with-honest-staleness;
forged signature refused with revocation still standing; unknown and revoked key;
all five cross-scope refusals including a second Hub in the same Location; unsupported
schema; malformed payload; sequence rollback; watermark rollback; atomic supersede;
**restart** via a brand-new pool still denying; **reconnection** with a serial-omitting
snapshot still denying.

## §11 — canonical verification (fresh, serial, Node 22.23.0)

Database target `postgresql://…@127.0.0.1:54322/postgres` and `kitluy_hub_local`.
Roles exercised: `kitluy_issuance_service`, `kitluy_worker_service`, `authenticated`,
`kitluy_credential_issuer` (borrowed and returned), `kitluy_hub_runtime`, `postgres`.

| Step | Exit | Result |
| ---- | ---- | ------ |
| `db:reset` (0000→0156 from zero) | 0 | 0156 assertions fired |
| `db:seed` | 0 | — |
| `db:test` | 0 | **196 PASS, 0 FAIL** |
| `test:rls` | 0 | **104 PASS** |
| `hub:db:reset` | 0 | 28 migrations |
| `@kitluy/device-identity` | 0 | **780 passed (33 files)** |
| device-registry-service | 0 | **123 passed, 0 skipped (9 files)** |
| hub-revocation-offline | 0 | **12 passed** |
| typecheck / lint / clock:check / migrations:validate | 0 | lint 0 errors |
| `secret:scan` | 0 | clean, **1229** files |
| `db:validate` | 1 | **4** `schemas-in-dictionary` false positives |
| `format:check` | 1 | 804 files (CRLF artifact) |
| `docs:verify` | 1 | 1 of 8 (`check-classified`) |

**Disclosed, not hidden:**

- `db:validate` was 3 and is now **4**. The fourth is **mine** — group 0156 names
  `kitluy_activation_governor` / `kitluy_credential_issuer`, which the checker reads as
  schemas. Same known false-positive class as 0127/0131/0152, but newly added by me and
  reported as such rather than folded into "pre-existing".
- `format:check` 804 files — `core.autocrlf=true`, no `.gitattributes`, Prettier
  `endOfLine: "lf"`. Pre-existing.
- `docs:verify` `check-classified` on imported source documents. Pre-existing.
- **Hub agent suite baseline:** 8 failures / 143 passes BEFORE this work, 8 failures /
  155 passes AFTER — verified by stashing and re-running. The 8 are pre-existing. One
  regression I introduced (`HUB_MIGRATION_ORDER` omitted 0027) is fixed.
- **Hub environment condition:** the Hub suites need `kitluy_hub_runtime` granted to the
  connecting user to exercise the §3 GRANT surface. No repository script does this and
  there is no `hub:db:seed`; it was granted in the local database only.

## A defect of mine the gates caught

`secret:scan` refused the tree: my signer leak-test wrote real private-key MARKERS as
literals. Never a key — but a scanner taught to ignore "obviously fake" keys will one
day ignore a real one. The markers are now assembled at runtime; the leak assertions
compare against the assembled value and became stronger.

## NOT done

§8 the three concurrency cases (real 300-second expiry while parked; incident-scope
mutation while parked; identical vs conflicting replay). §9 production lifecycle.
§10 fresh independent re-review.

## FINAL STATUS

```text
WS-11-T003 Step 4 — NOT PROMOTED
```

Per §12 a reviewer blocker or missing concurrency test prevents promotion, and §8/§9/§10
are outstanding.

## Recommended next

1. §8 concurrency: the real clock-expiry race needs a repository-sanctioned controllable
   clock — decide the mechanism before writing the test.
2. §9 lifecycle through the production composition, now that the offline half exists.
3. §10 two fresh reviewers over the whole changeset.
4. Consider teaching `db:validate` the difference between a schema and a role name; four
   false positives now sit permanently in the output.
